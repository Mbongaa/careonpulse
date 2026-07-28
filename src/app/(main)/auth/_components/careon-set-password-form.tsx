"use client";

import { type FormEvent, useState } from "react";

import Link from "next/link";

import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAREON_LOGIN_ROUTE } from "@/lib/careon-auth";
import {
  CAREON_PASSWORD_HINT,
  CAREON_PASSWORD_MIN_LENGTH,
  isStrongCareonPassword,
  normalizeCareonPassword,
} from "@/lib/careon-password";

// Wachtwoord kiezen via de persoonlijk verstrekte link (variant A). Het token
// zit in de URL; de server verzilvert het éénmalig — bij succes logt de
// gebruiker daarna gewoon in met het zojuist gekozen wachtwoord.
export function CareonSetPasswordForm({ token }: Readonly<{ token: string }>) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aparte stand voor een ongeldig/verlopen token: de meest voorkomende
  // oorzaak is een tweede klik op een al gebruikte (eenmalige) link — die
  // gebruiker moet gewoon naar de inlogpagina, niet naar de beheerder.
  const [linkOngeldig, setLinkOngeldig] = useState(false);

  if (!token) {
    return (
      <p className="text-muted-foreground text-sm">
        Deze pagina werkt alleen via de persoonlijke link die u van uw beheerder heeft gekregen.
      </p>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-emerald-700 text-sm dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          Uw wachtwoord is ingesteld. U kunt nu inloggen met uw e-mailadres.
        </p>
        <Button asChild className="w-full">
          <Link href={CAREON_LOGIN_ROUTE}>Naar inloggen</Link>
        </Button>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // Zelfde normalisatie als de server: rand-spaties (kopieerfout) tellen
    // nooit mee, dus wat hier gevalideerd wordt is exact wat wordt opgeslagen.
    const gekozen = normalizeCareonPassword(password);
    if (!isStrongCareonPassword(gekozen)) {
      setError(CAREON_PASSWORD_HINT);
      return;
    }
    if (gekozen !== normalizeCareonPassword(repeat)) {
      setError("De wachtwoorden komen niet overeen.");
      return;
    }
    setBusy(true);
    setError(null);
    setLinkOngeldig(false);
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash: token, password: gekozen }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error ?? "Wachtwoord instellen mislukte. Probeer het opnieuw.");
        setLinkOngeldig(Boolean(payload?.error?.startsWith("Deze link is ongeldig")));
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="set-password">Nieuw wachtwoord</Label>
        <Input
          id="set-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={CAREON_PASSWORD_MIN_LENGTH}
          aria-describedby="set-password-hint"
          required
        />
        <p id="set-password-hint" className="text-muted-foreground text-xs">
          {CAREON_PASSWORD_HINT}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="set-password-repeat">Herhaal wachtwoord</Label>
        <Input
          id="set-password-repeat"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          minLength={CAREON_PASSWORD_MIN_LENGTH}
          required
        />
      </div>
      {error && (
        <p role="status" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {linkOngeldig && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground text-sm">
          <p>
            Heeft u via deze link al een wachtwoord ingesteld? De link vervalt daarna direct — log dan gewoon in met uw
            e-mailadres en het gekozen wachtwoord.
          </p>
          <p>Nog geen wachtwoord ingesteld? Vraag uw beheerder om een nieuwe link.</p>
          <Button asChild variant="outline" className="w-full">
            <Link href={CAREON_LOGIN_ROUTE}>Naar inloggen</Link>
          </Button>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={busy || !password || !repeat}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Wachtwoord opslaan
      </Button>
    </form>
  );
}
