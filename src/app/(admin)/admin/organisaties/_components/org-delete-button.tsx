"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { AdminActieMelding } from "../../_components/admin-ui";

// Opruimen van een verkeerd aangemaakte organisatie. De route weigert zodra er
// nog leden, registraties, imports of gesprekken aan hangen en zegt precies wat
// er in de weg zit; die melding tonen we hier letterlijk.
export function OrgDeleteButton({ id, name }: Readonly<{ id: string; name: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function verwijder() {
    if (busy) return;
    if (
      !window.confirm(
        // Eerlijk over het enige dat wél blijft: audit-rijen overleven de
        // verwijdering maar verliezen hun organisatiekoppeling (0012, on
        // delete set null) — daarna is "wat gebeurde er in organisatie X" niet
        // meer via het organisatiefilter te beantwoorden.
        `${name} verwijderen? Dit kan alleen als er geen leden en geen data meer aan hangen. Audit-rijen van deze organisatie blijven bestaan, maar verliezen hun organisatiekoppeling en vallen daarna buiten het organisatiefilter van het logboek.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/organizations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage(payload?.error ?? "Verwijderen mislukt.");
        return;
      }
      router.replace("/admin/organisaties");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={verwijder}>
        Verwijder organisatie
      </Button>
      {message && <AdminActieMelding tone="fout">{message}</AdminActieMelding>}
    </span>
  );
}
