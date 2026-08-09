"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAREON_PASSWORD_HINT, CAREON_PASSWORD_MIN_LENGTH, isStrongCareonPassword } from "@/lib/careon-password";

import { AdminActieMelding } from "../../_components/admin-ui";

// Handmatige provisioning (handoff 13, besluit 3): de beheerder kiest het
// startwachtwoord en geeft het zelf door — er verlaat geen e-mail het systeem.
export function UserCreateForm({ organizations }: Readonly<{ organizations: { id: string; name: string }[] }>) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState(organizations.length > 0 ? organizations[0].id : "");
  const [role, setRole] = useState<"member" | "org_admin">("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "fout"; tekst: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName, password, orgId, role }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage({ tone: "fout", tekst: payload?.error ?? "Aanmaken mislukt." });
        return;
      }
      setEmail("");
      setFullName("");
      setPassword("");
      setMessage({ tone: "ok", tekst: "Gebruiker aangemaakt. Geef het wachtwoord persoonlijk door." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-email">E-mail</Label>
        <Input
          id="user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="naam@organisatie.nl"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-name">Naam</Label>
        <Input id="user-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Naam" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-password">Startwachtwoord</Label>
        <Input
          id="user-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Sterk startwachtwoord"
          minLength={CAREON_PASSWORD_MIN_LENGTH}
          aria-describedby="user-password-hint"
          required
        />
        <span id="user-password-hint" className="max-w-64 text-muted-foreground text-xs">
          {CAREON_PASSWORD_HINT}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-org">Organisatie</Label>
        <select
          id="user-org"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-role">Rol</Label>
        <select
          id="user-role"
          value={role}
          onChange={(e) => setRole(e.target.value === "org_admin" ? "org_admin" : "member")}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="member">Gebruiker</option>
          <option value="org_admin">Organisatiebeheerder</option>
        </select>
      </div>
      <Button type="submit" disabled={busy || !email.trim() || !isStrongCareonPassword(password) || !orgId}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Aanmaken
      </Button>
      {message && (
        <p className="w-full">
          <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>
        </p>
      )}
    </form>
  );
}
