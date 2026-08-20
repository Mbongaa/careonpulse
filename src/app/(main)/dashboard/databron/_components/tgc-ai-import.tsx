"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Bot, Check, Circle, Clock3, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { useCareonSessionInfo } from "@/app/(main)/dashboard/_components/careon/careon-session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TgcSyncJob } from "@/lib/careon-production/tgc-sync-jobs";
import { cn } from "@/lib/utils";

const ACTIVE = new Set<TgcSyncJob["status"]>(["queued", "running"]);
const JOB_SESSION_KEY = "careon:tgc-sync-job";

const PROCEDURE = [
  { key: "login", label: "Veilig aanmelden bij TGC" },
  { key: "exports", label: "Vijf volledige EPD-exports ophalen" },
  { key: "validation", label: "Bestanden en privacyvelden valideren" },
  { key: "upload", label: "Gevalideerde snapshots naar Supabase sturen" },
  { key: "verification", label: "Centrale dashboardstand controleren" },
] as const;

const STAGE_ORDER: Record<string, number> = {
  queued: -1,
  login: 0,
  clients: 1,
  agenda: 1,
  referrers: 1,
  surcharges: 1,
  declarations: 1,
  validation: 2,
  upload: 3,
  verification: 4,
  completed: 5,
};

function eventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Gebruik de generieke melding hieronder.
  }
  return "De importupdate kon niet worden gestart.";
}

export function TgcAiImport() {
  const { authed, orgId } = useCareonSessionInfo();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<TgcSyncJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const priorStatus = useRef<TgcSyncJob["status"] | null>(null);

  const readJob = useCallback(async (jobId?: string) => {
    const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    const response = await fetch(`/api/careon/tgc-sync${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response));
    const body = (await response.json()) as { job?: TgcSyncJob | null };
    return body.job ?? null;
  }, []);

  // Recover an active request made from Careon AI or a previous page visit.
  useEffect(() => {
    if (!authed || !orgId) return;
    let cancelled = false;
    const remembered = window.sessionStorage.getItem(JOB_SESSION_KEY) ?? undefined;
    void readJob(remembered)
      .then((latest) => {
        if (cancelled || !latest) return;
        setJob(latest);
        if (remembered || ACTIVE.has(latest.status)) setOpen(true);
      })
      .catch(() => {
        // De knop blijft bruikbaar; een statusread is best-effort.
      });
    return () => {
      cancelled = true;
    };
  }, [authed, orgId, readJob]);

  useEffect(() => {
    if (!open || !job || !ACTIVE.has(job.status)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void readJob(job.id)
        .then((latest) => {
          if (cancelled || !latest) return;
          setJob(latest);
          setError(null);
        })
        .catch((pollError: unknown) => {
          if (!cancelled) setError(pollError instanceof Error ? pollError.message : "Status kon niet worden gelezen.");
        });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [job, open, readJob]);

  // The provider reads the newest central snapshots on mount. Reload once
  // after a live transition so every dashboard tile adopts the new import.
  useEffect(() => {
    const previous = priorStatus.current;
    priorStatus.current = job?.status ?? null;
    if (job?.status !== "succeeded" || (previous !== "queued" && previous !== "running")) return;
    const timer = window.setTimeout(() => window.location.reload(), 1_500);
    return () => window.clearTimeout(timer);
  }, [job]);

  async function start() {
    setOpen(true);
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/careon/tgc-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedVia: "databron" }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { job: TgcSyncJob };
      window.sessionStorage.setItem(JOB_SESSION_KEY, body.job.id);
      setJob(body.job);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "De importupdate kon niet worden gestart.");
    } finally {
      setStarting(false);
    }
  }

  const currentOrder = job ? (STAGE_ORDER[job.stage] ?? -1) : -1;
  const busy = starting || Boolean(job && ACTIVE.has(job.status));

  return (
    <section className="flex flex-col gap-3 border-b pb-4" aria-label="AI-importupdate">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void start()} disabled={!authed || !orgId || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
          Update imports through AI
        </Button>
        <span className="text-muted-foreground text-xs">De handmatige import hieronder blijft altijd beschikbaar.</span>
      </div>

      {open && (
        <div
          className="flex flex-col gap-3 rounded-xl border border-violet-600/25 bg-violet-500/[0.04] p-3"
          data-testid="tgc-ai-import-status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 font-medium text-sm">
                <Bot className="size-4 text-violet-700 dark:text-violet-400" />
                AI-importassistent
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {starting ? "De beveiligde update wordt klaargezet…" : (job?.message ?? "Klaar om te starten.")}
              </p>
            </div>
            {job && (
              <Badge
                variant="outline"
                className={cn(
                  job.status === "succeeded" && "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
                  job.status === "failed" && "border-red-600/40 text-red-700 dark:text-red-400",
                )}
              >
                {job.status === "queued" && "In wachtrij"}
                {job.status === "running" && "Bezig"}
                {job.status === "succeeded" && "Geslaagd"}
                {job.status === "failed" && "Mislukt"}
              </Badge>
            )}
          </div>

          <Progress value={starting ? 2 : (job?.progress ?? 0)} aria-label="Voortgang AI-import" />

          <ol className="grid gap-1.5 sm:grid-cols-2">
            {PROCEDURE.map((step, index) => {
              const done = job?.status === "succeeded" || currentOrder > index;
              const active = job?.status !== "failed" && currentOrder === index;
              let Icon = Circle;
              if (done) Icon = Check;
              else if (active) Icon = Loader2;
              return (
                <li key={step.key} className="flex items-center gap-2 text-xs">
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      done && "text-emerald-700 dark:text-emerald-400",
                      active && "animate-spin text-violet-700 dark:text-violet-400",
                      !done && !active && "text-muted-foreground",
                    )}
                  />
                  <span className={cn(!done && !active && "text-muted-foreground")}>{step.label}</span>
                </li>
              );
            })}
          </ol>

          {job?.events.length ? (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border bg-background/70 p-2 text-xs">
              {job.events.slice(-6).map((event) => (
                <p key={`${event.at}-${event.stage}-${event.message}`} className="flex gap-2">
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{eventTime(event.at)}</span>
                  <span>{event.message}</span>
                </p>
              ))}
            </div>
          ) : null}

          {job?.status === "succeeded" && (
            <p className="flex items-start gap-2 text-emerald-700 text-xs dark:text-emerald-400">
              <Check className="mt-0.5 size-3.5 shrink-0" />
              Alle vijf exports zijn gecontroleerd en centraal bijgewerkt. De dashboarddata wordt nu opnieuw geladen.
            </p>
          )}
          {(error || job?.status === "failed") && (
            <div className="flex flex-wrap items-center gap-2 text-red-700 text-xs dark:text-red-400" role="alert">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span>{error ?? job?.error ?? "De automatische import is mislukt."}</span>
              {!busy && (
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void start()}>
                  <RefreshCw className="size-3.5" />
                  Opnieuw proberen
                </Button>
              )}
            </div>
          )}
          {job?.status === "queued" && (
            <p className="flex items-start gap-2 text-muted-foreground text-xs">
              <Clock3 className="mt-0.5 size-3.5 shrink-0" />
              De opdracht start automatisch zodra de lokale TGC-worker beschikbaar is; u hoeft niets meer in te voeren.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
