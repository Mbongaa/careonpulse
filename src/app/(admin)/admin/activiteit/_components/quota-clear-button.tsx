"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { AdminActieMelding } from "../../_components/admin-ui";

/**
 * Blokkade opheffen. Bedoeld voor het geval dat support daadwerkelijk krijgt:
 * een hele praktijk achter één NAT die het dagplafond heeft geraakt en tot
 * middernacht UTC niet meer kan inloggen.
 */
export function QuotaClearButton({
  scope,
  actorHash,
  label,
}: Readonly<{ scope: string; actorHash: string; label: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "fout"; tekst: string } | null>(null);

  async function wis() {
    if (busy) return;
    if (!window.confirm(`Limiet voor ${label} opheffen? De blokkade vervalt daarmee direct.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/rate-limits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, actorHash }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; gewist?: boolean } | null;
      if (!response.ok) {
        setMessage({ tone: "fout", tekst: payload?.error ?? "Wissen mislukt." });
        return;
      }
      setMessage({
        tone: "ok",
        tekst: payload?.gewist ? "Limiet opgeheven." : "Deze limiet was al vervallen.",
      });
      router.refresh();
    } catch {
      setMessage({ tone: "fout", tekst: "Wissen mislukt — netwerkfout." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={wis}>
        Limiet opheffen
      </Button>
      {message && <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>}
    </span>
  );
}
