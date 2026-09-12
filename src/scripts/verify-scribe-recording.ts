import { runTranscriptionRound } from "./lib/scribe-recording-harness";
import { resolve } from "node:path";

/**
 * npx ts-node -r tsconfig-paths/register -P tsconfig.scripts.json
 *   src/scripts/verify-scribe-recording.ts --audio <teaching.mp3> --run smoke --end 32
 * Omit --end for the complete recording; use --fragment 60 --overlap 0 for a
 * longer-context comparison transcript. Each run ID resumes its own evidence.
 */
async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index];
    const value = process.argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Expected --option value pairs.");
    args.set(flag.slice(2), value);
  }
  const audioPath = args.get("audio");
  const runId = args.get("run");
  if (!audioPath || !runId) throw new Error("Required: --audio teaching.mp3 --run unique-run-name.");
  const number = (name: string): number | undefined => {
    const value = args.get(name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("Invalid numerical option.");
    return parsed;
  };
  await runTranscriptionRound({
    audioPath: resolve(audioPath),
    runId,
    outputDir: resolve(args.get("output") ?? ".next-e2e/scribe-audio-20260911"),
    startSeconds: number("start"),
    endSeconds: number("end"),
    fragmentSeconds: number("fragment"),
    overlapSeconds: number("overlap"),
    onProgress: (metrics) => process.stdout.write(`${JSON.stringify(metrics)}\n`),
  });
}

void main().catch(() => {
  process.stderr.write("Teaching verification stopped; inspect the local metadata checkpoint. No content logged.\n");
  process.exitCode = 1;
});
