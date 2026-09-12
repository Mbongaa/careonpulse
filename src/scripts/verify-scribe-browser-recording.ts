/**
 * Isolated teaching-audio browser acceptance, explicitly invoked by an owner.
 * Runs the real /scribe UI + PCM recorder + provider adapters. Persistence is
 * an in-memory test adapter, NOT Supabase/RLS acceptance. No production flags
 * or application routes are changed. All audio stays in process/browser RAM.
 *
 * ts-node -r tsconfig-paths/register -P tsconfig.scripts.json ...
 */

import { chromium, expect, type Page } from "@playwright/test";

import { summarizeScribeBrowserEvidence } from "./lib/scribe-browser-evidence";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface ReplayController {
  elapsed(): number;
  duration: number;
  decodedDuration: number;
  sampleRate: number;
  channels: number;
  inputStoppedAt: number | null;
  ended: boolean;
  paused: boolean;
  begin(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

declare global {
  interface Window {
    __scribeTeachingReplay?: ReplayController;
  }
}

function option(name: string, fallback = ""): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function capture(page: Page, outputDir: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
  await fs.writeFile(path.join(outputDir, `${name}.txt`), await page.locator("body").innerText());
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const baseUrl = option("base-url", "http://127.0.0.1:3311");
  const destination = new URL(baseUrl);
  if (destination.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(destination.hostname)) {
    throw new Error("Teaching browser tests are restricted to local HTTP origins.");
  }
  const audioPath = path.resolve(option("audio"));
  const runId = option("run", "browser-smoke");
  if (!/^[a-zA-Z0-9_-]{1,70}$/.test(runId)) throw new Error("Invalid run ID.");
  const seconds = Number(option("seconds", "749.076"));
  const pauseAt = Number(option("pause-at", "0"));
  const pauseSeconds = Number(option("pause-seconds", "5"));
  const minimumRecordedEndSeconds = option("minimum-recorded-end-seconds")
    ? Number(option("minimum-recorded-end-seconds"))
    : undefined;
  if (
    !(seconds > 0 && seconds <= 1800 && pauseAt >= 0 && pauseAt < seconds && pauseSeconds >= 0 && pauseSeconds <= 30)
  ) {
    throw new Error("Invalid bounded replay duration.");
  }
  if (
    minimumRecordedEndSeconds !== undefined &&
    !(minimumRecordedEndSeconds > 0 && minimumRecordedEndSeconds <= seconds)
  ) {
    throw new Error("Invalid minimum audio coverage expectation.");
  }
  const outputDir = path.join(repoRoot, ".next-e2e", "scribe-audio-20260911", runId);
  await fs.mkdir(outputDir, { recursive: true });
  const previousResult = await fs.stat(path.join(outputDir, "browser-result.json")).catch(() => null);
  if (previousResult) throw new Error("This run already has evidence. Choose a new --run name.");
  const { loadTeachingProviderEnvironment } = await import("./lib/scribe-recording-harness");
  await loadTeachingProviderEnvironment(repoRoot);
  process.env.CAREON_ASSISTANT_LIVE = "1";
  const { createScribeBrowserTestBackend } = await import("./lib/scribe-browser-test-backend");
  const backend = await createScribeBrowserTestBackend({ outputDir });
  const audio = await fs.readFile(audioPath);
  const sourceFiles = [
    "src/lib/careon-scribe/opname.client.ts",
    "src/lib/careon-scribe/transcriptie.server.ts",
    "src/lib/careon-scribe/overlap.ts",
    "src/lib/careon-scribe/agent.server.ts",
    "src/lib/careon-scribe/gesprekscontext.ts",
    "src/lib/careon-scribe/klinische-staat.ts",
    "src/lib/careon-scribe/deterministisch.ts",
    "src/lib/careon-scribe/english-evidence.ts",
    "src/lib/careon-scribe/english-report.ts",
    "src/scripts/lib/scribe-browser-test-backend.ts",
    "src/scripts/verify-scribe-browser-recording.ts",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(repoRoot, file)))
          .digest("hex"),
      ]),
    ),
  );
  const provenance = {
    recording: {
      fileName: path.basename(audioPath),
      bytes: audio.length,
      sha256: createHash("sha256").update(audio).digest("hex"),
    },
    sourceHashes,
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outputDir, "provenance.json"), JSON.stringify(provenance, null, 2));
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const errors: string[] = [];
  let pendingRequests = 0;
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== destination.origin) {
      errors.push(`Blocked unexpected browser request origin: ${url.origin}`);
      await route.abort();
      return;
    }
    if (url.pathname === "/__scribe_teaching_audio") {
      await route.fulfill({ status: 200, contentType: "audio/mpeg", body: audio });
      return;
    }
    if (url.pathname.startsWith("/api/careon/scribe/")) {
      pendingRequests += 1;
      try {
        const reply = await backend.handle({
          method: request.method(),
          url: request.url(),
          headers: request.headers(),
          body: request.postDataBuffer() ?? undefined,
        });
        await route.fulfill({
          status: reply.status,
          headers: { "Content-Type": "application/json", ...reply.headers },
          body: reply.body ?? JSON.stringify(reply.json),
        });
      } finally {
        pendingRequests -= 1;
      }
      return;
    }
    await route.continue();
  });
  await page.addInitScript(
    ({ limitSeconds }) => {
      // Inject only the input device in the disposable test browser. The app's
      // getUserMedia consumer, resampler, WAV encoder, queue and API client run
      // unchanged. The input source is never connected to system speakers.
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const playback = new AudioContext();
          const bytes = await (await fetch("/__scribe_teaching_audio")).arrayBuffer();
          const decoded = await playback.decodeAudioData(bytes);
          const source = playback.createBufferSource();
          source.buffer = decoded;
          const destinationStream = playback.createMediaStreamDestination();
          source.connect(destinationStream);
          const duration = Math.min(limitSeconds, decoded.duration);
          let beganAt: number | null = null;
          const controller: ReplayController = {
            duration,
            decodedDuration: decoded.duration,
            sampleRate: decoded.sampleRate,
            channels: decoded.numberOfChannels,
            inputStoppedAt: null,
            ended: false,
            paused: false,
            elapsed: () => (beganAt === null ? 0 : Math.min(duration, playback.currentTime - beganAt)),
            begin: () => {
              if (beganAt !== null) return;
              beganAt = playback.currentTime;
              source.start(0, 0, duration);
            },
            pause: async () => {
              await playback.suspend();
              controller.paused = true;
            },
            resume: async () => {
              await playback.resume();
              controller.paused = false;
            },
          };
          source.onended = () => {
            controller.ended = true;
          };
          for (const track of destinationStream.stream.getTracks()) {
            const stopInput = track.stop.bind(track);
            track.stop = () => {
              controller.inputStoppedAt = controller.elapsed();
              stopInput();
            };
          }
          window.__scribeTeachingReplay = controller;
          await playback.resume();
          return destinationStream.stream;
        },
      });
    },
    { limitSeconds: seconds },
  );
  const startedAt = Date.now();
  const progress: Array<Record<string, unknown>> = [];
  try {
    await page.goto(`${baseUrl}/auth/v1/login`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await page.getByPlaceholder("Wachtwoord").fill("demo1234");
    await page.getByRole("button", { name: "Inloggen", exact: true }).click();
    await page.waitForURL("**/modules", { timeout: 60_000 });
    await page.goto(`${baseUrl}/scribe`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByRole("button", { name: "Nieuw consult", exact: true }).click();
    await page.getByLabel("Dossierreferentie", { exact: true }).fill(`QA-${runId}`);
    await page.getByLabel("Consulttype", { exact: true }).selectOption("psychiatrie");
    await page.getByLabel("Taal", { exact: true }).selectOption("en");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Consult starten", exact: true }).click();
    await page.getByRole("button", { name: "Opname starten", exact: true }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Opname pauzeren", exact: true }).waitFor({ timeout: 30_000 });
    await page.evaluate(() => {
      const label = document.createElement("div");
      label.textContent = "ISOLATED TEACHING-AUDIO TEST · real providers · in-memory test database";
      Object.assign(label.style, {
        position: "fixed",
        bottom: "0",
        left: "0",
        zIndex: "99999",
        background: "#fff3cd",
        color: "#332701",
        padding: "6px 12px",
        font: "13px sans-serif",
        pointerEvents: "none",
      });
      document.body.append(label);
      window.__scribeTeachingReplay?.begin();
    });
    const decodedAudio = await page.evaluate(() => {
      const value = window.__scribeTeachingReplay;
      return value
        ? {
            duration: value.duration,
            decodedDuration: value.decodedDuration,
            sampleRate: value.sampleRate,
            channels: value.channels,
          }
        : null;
    });
    await fs.writeFile(
      path.join(outputDir, "provenance.json"),
      JSON.stringify({ ...provenance, decodedAudio }, null, 2),
    );
    let paused = false;
    let replayCompleted = false;
    let nextProgress = 20;
    let nextCapture = 30;
    while (Date.now() - startedAt < (seconds + pauseSeconds + 240) * 1000) {
      await page.waitForTimeout(1000);
      const replay = await page.evaluate(() => {
        const value = window.__scribeTeachingReplay;
        return value ? { elapsed: value.elapsed(), ended: value.ended, inputStoppedAt: value.inputStoppedAt } : null;
      });
      if (!replay) throw new Error("Audio replay controller disappeared.");
      if (replay.inputStoppedAt !== null && !replay.ended) {
        throw new Error(
          `Recorder input stopped at ${replay.inputStoppedAt.toFixed(1)} seconds while source audio was still playing.`,
        );
      }
      if (!paused && pauseAt > 0 && replay.elapsed >= pauseAt && !replay.ended) {
        await page.evaluate(() => window.__scribeTeachingReplay?.pause());
        await page.getByRole("button", { name: "Opname pauzeren", exact: true }).click();
        await capture(page, outputDir, "paused");
        await page.waitForTimeout(pauseSeconds * 1000);
        await page.getByRole("button", { name: "Opname hervatten", exact: true }).click();
        await page.evaluate(() => window.__scribeTeachingReplay?.resume());
        paused = true;
      }
      if (replay.elapsed >= nextProgress) {
        const row = { runId, elapsedSeconds: Math.round(replay.elapsed), paused, pageErrors: errors.length };
        progress.push(row);
        console.log(JSON.stringify(row));
        await backend.save();
        nextProgress += 30;
      }
      if (replay.elapsed >= nextCapture) {
        await capture(page, outputDir, `recording-${Math.round(replay.elapsed)}`);
        nextCapture += 180;
      }
      if (replay.ended) {
        replayCompleted = true;
        break;
      }
    }
    if (!replayCompleted) throw new Error("Replay deadline exceeded before the requested recording completed.");
    if (pauseAt > 0 && !paused) throw new Error("The requested pause/resume cycle did not occur.");
    await page.getByRole("button", { name: "Opname stoppen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeEnabled({ timeout: 180_000 });
    await capture(page, outputDir, "recording-finished");
    await page.getByRole("button", { name: "Consult afronden", exact: true }).click();
    // The report heading appears as soon as status changes, BEFORE asynchronous
    // report generation finishes. Wait for actual note controls, not that shell.
    await page.getByLabel("Verslagformaat", { exact: true }).waitFor({ timeout: 180_000 });
    await capture(page, outputDir, "report");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, outputDir, "report-phone");
    await expect.poll(() => pendingRequests, { timeout: 10_000 }).toBe(0);
    await backend.save();
    const evidenceSummary = summarizeScribeBrowserEvidence(backend.snapshot(), {
      browserErrors: errors,
      replayCompleted,
      requestedSeconds: seconds,
      pendingRequests,
      minimumRecordedEndSeconds,
    });
    await fs.writeFile(path.join(outputDir, "evidence-summary.json"), JSON.stringify(evidenceSummary, null, 2));
    if (evidenceSummary.executionPassed !== true) {
      throw new Error("Browser execution assertions failed; inspect evidence-summary.json.");
    }
    await fs.writeFile(
      path.join(outputDir, "browser-result.json"),
      JSON.stringify(
        {
          runId,
          completed: true,
          requestedSeconds: seconds,
          pauseAt,
          pauseSeconds,
          paused,
          durationMs: Date.now() - startedAt,
          errors,
          progress,
          limitations: ["Injected teaching audio MediaStream", "In-memory persistence; not Supabase/RLS acceptance"],
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ runId, completed: true, pageErrors: errors.length, outputDir }));
  } catch (error) {
    await backend.save();
    await capture(page, outputDir, "failure").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Browser teaching test failed";
    await fs.writeFile(
      path.join(outputDir, "browser-result.json"),
      JSON.stringify(
        {
          runId,
          completed: false,
          error: message,
          errors,
          progress,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Browser teaching test failed");
  process.exitCode = 1;
});
