import Link from "next/link";

import { CheckCircle2, CircleHelp, DatabaseBackup, ServerCog, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CareonOperationsStatus,
  OperationsBackupStatus,
  OperationsWorkerStatus,
} from "@/lib/careon-operations/operations-status";
import { cn } from "@/lib/utils";

type StatusTone = "healthy" | "warning" | "critical" | "neutral";

interface StatusPresentation {
  label: string;
  description: string;
  tone: StatusTone;
}

const TONE_CLASS: Record<StatusTone, string> = {
  healthy: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  critical: "border-red-600/40 text-red-700 dark:text-red-400",
  neutral: "text-muted-foreground",
};

function operationTime(value: string | null): string {
  if (!value) return "geen betrouwbaar tijdstip";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "geen betrouwbaar tijdstip";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function workerPresentation(worker: OperationsWorkerStatus): StatusPresentation {
  if (worker.state === "available") {
    return {
      label: "Beschikbaar",
      description: `Laatste heartbeat: ${operationTime(worker.lastSeenAt)}.`,
      tone: "healthy",
    };
  }
  if (worker.state === "offline") {
    return {
      label: "Niet bereikbaar",
      description: `Laatste heartbeat: ${operationTime(worker.lastSeenAt)}. Nieuwe imports blijven veilig in de wachtrij.`,
      tone: "critical",
    };
  }
  if (worker.state === "not_configured") {
    return {
      label: "Niet ingericht",
      description: "Voor deze organisatie is geen TGC-importworker gekoppeld.",
      tone: "neutral",
    };
  }
  if (worker.state === "unavailable") {
    return {
      label: "Status niet leesbaar",
      description: "De centrale statusbron antwoordt momenteel niet.",
      tone: "warning",
    };
  }
  return { label: "Onbekend", description: "Er is nog geen betrouwbare workerheartbeat ontvangen.", tone: "warning" };
}

function backupPresentation(backup: OperationsBackupStatus): StatusPresentation {
  if (backup.state === "healthy") {
    return {
      label: "Actueel",
      description: `Laatste geslaagde reservekopie: ${operationTime(backup.lastSuccessAt)}.`,
      tone: "healthy",
    };
  }
  if (backup.state === "failed") {
    return {
      label: "Mislukt",
      description: `Laatste poging: ${operationTime(backup.lastAttemptAt)}. Controleer de beheerde backuptaak.`,
      tone: "critical",
    };
  }
  if (backup.state === "stale") {
    return {
      label: "Verouderd",
      description: `Laatste geslaagde reservekopie: ${operationTime(backup.lastSuccessAt)}.`,
      tone: "critical",
    };
  }
  if (backup.state === "disabled") {
    return {
      label: "Nog niet geactiveerd",
      description: "De versleutelde externe Facturatie-reservekopie wacht op de TGC-bestemming en sleutelbewaring.",
      tone: "warning",
    };
  }
  if (backup.state === "misconfigured") {
    return {
      label: "Configuratiefout",
      description: "De backupmonitor is onvolledig geconfigureerd.",
      tone: "critical",
    };
  }
  if (backup.state === "not_configured") {
    return {
      label: "Geen resultaat",
      description: "Er is nog geen reservekopiepoging geregistreerd.",
      tone: "warning",
    };
  }
  if (backup.state === "unavailable") {
    return {
      label: "Status niet leesbaar",
      description: "De centrale backupstatus antwoordt momenteel niet.",
      tone: "warning",
    };
  }
  return { label: "Onbekend", description: "Er is nog geen betrouwbare backupstatus beschikbaar.", tone: "warning" };
}

function StatusIcon({ tone }: Readonly<{ tone: StatusTone }>) {
  if (tone === "healthy") return <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" />;
  if (tone === "critical") return <TriangleAlert className="size-4 text-red-700 dark:text-red-400" />;
  return <CircleHelp className="size-4 text-amber-700 dark:text-amber-400" />;
}

export function OperationsStatusPanel({ status }: Readonly<{ status: CareonOperationsStatus }>) {
  const worker = workerPresentation(status.worker);
  const backup = backupPresentation(status.backup);

  return (
    <Card data-testid="operations-status-panel">
      <CardHeader className="gap-2 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Platformbewaking</CardTitle>
            <p className="mt-1 text-muted-foreground text-sm">
              Operationele beschikbaarheid zonder patiënt-, factuur-, bestands- of credentialgegevens.
            </p>
          </div>
          <Badge variant="outline">Alleen voor beheer</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
        <section className="rounded-lg border p-4" aria-label="TGC-importworkerstatus">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-medium text-sm">
              <ServerCog className="size-4" /> TGC-importworker
            </p>
            <Badge variant="outline" className={cn(TONE_CLASS[worker.tone])}>
              <StatusIcon tone={worker.tone} /> {worker.label}
            </Badge>
          </div>
          <p className="mt-3 text-muted-foreground text-sm">{worker.description}</p>
          <Button asChild variant="link" className="mt-2 h-auto p-0">
            <Link prefetch={false} href="/dashboard/databron">
              Open Databron
            </Link>
          </Button>
        </section>

        <section className="rounded-lg border p-4" aria-label="Facturatie-backupstatus">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-medium text-sm">
              <DatabaseBackup className="size-4" /> Facturatie-reservekopie
            </p>
            <Badge variant="outline" className={cn(TONE_CLASS[backup.tone])}>
              <StatusIcon tone={backup.tone} /> {backup.label}
            </Badge>
          </div>
          <p className="mt-3 text-muted-foreground text-sm">{backup.description}</p>
          <Button asChild variant="link" className="mt-2 h-auto p-0">
            <Link prefetch={false} href="/facturatie">
              Open Facturatie
            </Link>
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}
