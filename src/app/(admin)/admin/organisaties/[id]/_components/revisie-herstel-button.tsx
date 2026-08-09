"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { AdminActieMelding } from "../../../_components/admin-ui";

/**
 * Terugzetten van een eerdere stand van een handmatige registratie. De oude
 * momentopname wordt als nieuwe revisie toegevoegd — append-only blijft
 * intact, dus ook de foute stand blijft in de historie staan.
 */
export function RevisieHerstelButton({
  table,
  orgId,
  revisieId,
  revisie,
  label,
}: Readonly<{ table: string; orgId: string; revisieId: string; revisie: number; label: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "fout"; tekst: string } | null>(null);

  async function herstel() {
    if (busy) return;
    if (
      !window.confirm(
        `Revisie ${revisie} van ${label} terugzetten? Die stand wordt als nieuwe revisie opgeslagen; de huidige stand blijft in de historie staan. Gebruikers zien de teruggezette stand na het verversen van hun pagina.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/registraties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, orgId, revisieId }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; revision?: number } | null;
      if (!response.ok) {
        setMessage({ tone: "fout", tekst: payload?.error ?? "Herstellen mislukt." });
        return;
      }
      setMessage({ tone: "ok", tekst: `Teruggezet als revisie ${payload?.revision ?? "?"}.` });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={herstel}>
        Herstel deze revisie
      </Button>
      {message && <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>}
    </span>
  );
}
