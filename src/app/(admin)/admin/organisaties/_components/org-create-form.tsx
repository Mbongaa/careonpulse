"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AdminActieMelding } from "../../_components/admin-ui";

export function OrgCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "fout"; tekst: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage({ tone: "fout", tekst: payload?.error ?? "Aanmaken mislukt." });
        return;
      }
      setName("");
      setSlug("");
      setMessage({ tone: "ok", tekst: "Organisatie aangemaakt." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-name">Naam</Label>
        <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-slug">Slug</Label>
        <Input
          id="org-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="bijv. tgc-eindhoven"
          pattern="[a-z0-9][a-z0-9-]*"
          required
        />
      </div>
      <Button type="submit" disabled={busy || !name.trim() || !slug.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Aanmaken
      </Button>
      {message && <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>}
    </form>
  );
}
