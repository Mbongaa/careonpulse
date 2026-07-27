"use client";

import { type FormEvent, useState } from "react";

import { Loader2 } from "lucide-react";

import { WachtwoordLink } from "@/app/(main)/dashboard/_components/careon/wachtwoord-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Provisioning binnen de eigen organisatie (variant A): alleen e-mail, naam en
// rol — het wachtwoord kiest de nieuwe gebruiker zelf via de wachtwoord-link
// die de beheerder persoonlijk doorgeeft. De organisatie komt server-side uit
// de sessie.
export function MemberCreateForm({ onCreated }: Readonly<{ onCreated: () => void }>) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"member" | "org_admin">("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setInviteLink(null);
    try {
      const response = await fetch("/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName, role }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        inviteLink?: string | null;
      } | null;
      if (!response.ok) {
        setMessage(payload?.error ?? "Aanmaken mislukt.");
        return;
      }
      setEmail("");
      setFullName("");
      if (payload?.inviteLink) {
        setInviteLink(payload.inviteLink);
      } else {
        setMessage(
          "Account aangemaakt, maar de wachtwoord-link kon niet worden gegenereerd — gebruik 'Wachtwoord-link' bij het lid.",
        );
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="member-email">E-mail</Label>
        <Input
          id="member-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="naam@organisatie.nl"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="member-name">Naam</Label>
        <Input id="member-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Naam" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="member-role">Rol</Label>
        <select
          id="member-role"
          value={role}
          onChange={(e) => setRole(e.target.value === "org_admin" ? "org_admin" : "member")}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="member">Gebruiker</option>
          <option value="org_admin">Organisatiebeheerder</option>
        </select>
      </div>
      <Button type="submit" disabled={busy || !email.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Aanmaken
      </Button>
      {message && <p className="w-full text-muted-foreground text-sm">{message}</p>}
      {inviteLink && <WachtwoordLink link={inviteLink} />}
    </form>
  );
}
