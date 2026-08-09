"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { AdminActieMelding } from "../../_components/admin-ui";

// Hernoemen zonder migratie (spec §8). De slug staat er bewust naast en niet
// automatisch mee: hij is uniek en wordt elders als sleutel gebruikt, dus je
// wijzigt hem alleen als je hem expliciet invult.
export function OrgRenameForm({ id, name, slug }: Readonly<{ id: string; name: string; slug: string }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nieuweNaam, setNieuweNaam] = useState(name);
  const [nieuweSlug, setNieuweSlug] = useState(slug);
  // Momentopname van de slug bij het openen: het "ongewijzigd"-signaal moet
  // vergelijken met wat de beheerder zág, niet met de live prop — die kan
  // ondertussen door een router.refresh() (rename van een collega) verschuiven.
  const [basisSlug, setBasisSlug] = useState(slug);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "fout"; tekst: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: nieuweNaam, slug: nieuweSlug === basisSlug ? "" : nieuweSlug }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage({ tone: "fout", tekst: payload?.error ?? "Wijzigen mislukt." });
        return;
      }
      setMessage({ tone: "ok", tekst: "Opgeslagen." });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="flex flex-col gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Verse waarden bij het openen: de state is één keer geïnitialiseerd
            // en overleeft router.refresh(), dus zonder deze reset toonde het
            // formulier de waarden van vóór een rename van een collega — en
            // draaide "Opslaan" die rename stilzwijgend terug.
            setNieuweNaam(name);
            setNieuweSlug(slug);
            setBasisSlug(slug);
            setMessage(null);
            setOpen(true);
          }}
        >
          Hernoem
        </Button>
        {message && <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>}
      </span>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-56 flex-col gap-1.5">
      <Input
        aria-label={`Naam van ${name}`}
        value={nieuweNaam}
        onChange={(event) => setNieuweNaam(event.target.value)}
        required
      />
      <Input
        aria-label={`Slug van ${name}`}
        value={nieuweSlug}
        onChange={(event) => setNieuweSlug(event.target.value.toLowerCase())}
        pattern="[a-z0-9][a-z0-9-]*"
        required
      />
      <span className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={busy || nieuweNaam.trim() === ""}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Opslaan
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setNieuweNaam(name);
            setNieuweSlug(slug);
            setOpen(false);
          }}
        >
          Annuleer
        </Button>
      </span>
      {message && <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>}
    </form>
  );
}
