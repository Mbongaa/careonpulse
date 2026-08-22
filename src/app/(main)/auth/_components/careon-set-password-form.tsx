"use client";

import { type FormEvent, useState } from "react";

import Link from "next/link";

import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

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
import { cn } from "@/lib/utils";

// Wachtwoord kiezen via de persoonlijk verstrekte link (variant A). Het token
// zit in de URL; de server verzilvert het éénmalig — bij succes logt de
// gebruiker daarna gewoon in met het zojuist gekozen wachtwoord.
export function CareonSetPasswordForm({ token }: Readonly<{ token: string }>) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  // Twee losse oogknoppen met eigen naam: dit scherm vraagt een lang
  // wachtwoord én een herhaling, dus blind typen is hier het grootste risico.
  const [toonWachtwoord, setToonWachtwoord] = useState(false);
  const [toonHerhaling, setToonHerhaling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aparte stand voor een ongeldig/verlopen token: de meest voorkomende
  // oorzaak is een tweede klik op een al gebruikte (eenmalige) link — die
  // gebruiker moet gewoon naar de inlogpagina, niet naar de beheerder.
  const [linkOngeldig, setLinkOngeldig] = useState(false);

  if (!token) {
    return (
      <>
        <p className="careon-auth-note">
          Deze pagina werkt alleen via de persoonlijke link die u van uw beheerder heeft gekregen.
        </p>
        <div className="careon-auth-form">
          <Button asChild variant="outline" className="careon-auth-btn careon-auth-btn-secondary">
            <Link href={CAREON_LOGIN_ROUTE}>Naar inloggen</Link>
          </Button>
        </div>
      </>
    );
  }

  if (done) {
    return (
      <div className="careon-auth-form">
        <p className="careon-auth-success">
          <CheckCircle2 className="size-4 shrink-0" />
          Uw wachtwoord is ingesteld. U kunt nu inloggen met uw e-mailadres.
        </p>
        <Button asChild className="careon-auth-btn careon-auth-btn-primary">
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
    <form noValidate onSubmit={onSubmit} className="careon-auth-form">
      <div className="careon-auth-fields">
        <div className="careon-auth-field">
          <Label className="careon-auth-label" htmlFor="set-password">
            Nieuw wachtwoord
          </Label>
          <div className="careon-auth-input-wrap">
            <Input
              id="set-password"
              className={cn("careon-auth-input careon-auth-input-eye", error && "careon-auth-input-invalid")}
              placeholder="Nieuw wachtwoord"
              type={toonWachtwoord ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              minLength={CAREON_PASSWORD_MIN_LENGTH}
              aria-describedby="set-password-hint"
              aria-invalid={Boolean(error)}
              required
            />
            <button
              type="button"
              aria-label={toonWachtwoord ? "Nieuw wachtwoord verbergen" : "Nieuw wachtwoord tonen"}
              aria-pressed={toonWachtwoord}
              onClick={() => setToonWachtwoord((huidig) => !huidig)}
              className="careon-auth-eye"
            >
              {toonWachtwoord ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p id="set-password-hint" className="careon-auth-hint">
            {CAREON_PASSWORD_HINT}
          </p>
        </div>
        <div className="careon-auth-field">
          <Label className="careon-auth-label" htmlFor="set-password-repeat">
            Herhaal wachtwoord
          </Label>
          <div className="careon-auth-input-wrap">
            <Input
              id="set-password-repeat"
              className={cn("careon-auth-input careon-auth-input-eye", error && "careon-auth-input-invalid")}
              placeholder="Herhaal wachtwoord"
              type={toonHerhaling ? "text" : "password"}
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => {
                setRepeat(e.target.value);
                setError(null);
              }}
              minLength={CAREON_PASSWORD_MIN_LENGTH}
              aria-invalid={Boolean(error)}
              required
            />
            <button
              type="button"
              aria-label={toonHerhaling ? "Herhaald wachtwoord verbergen" : "Herhaald wachtwoord tonen"}
              aria-pressed={toonHerhaling}
              onClick={() => setToonHerhaling((huidig) => !huidig)}
              className="careon-auth-eye"
            >
              {toonHerhaling ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="careon-auth-error">
            <span aria-hidden="true" className="careon-auth-error-dot" />
            {error}
          </p>
        )}
      </div>
      {linkOngeldig && (
        <div className="careon-auth-notice">
          <p>
            Heeft u via deze link al een wachtwoord ingesteld? De link vervalt daarna direct — log dan gewoon in met uw
            e-mailadres en het gekozen wachtwoord.
          </p>
          <p>Nog geen wachtwoord ingesteld? Vraag uw beheerder om een nieuwe link.</p>
          <Button asChild variant="outline" className="careon-auth-btn careon-auth-btn-secondary">
            <Link href={CAREON_LOGIN_ROUTE}>Naar inloggen</Link>
          </Button>
        </div>
      )}
      {/* Bij een ongeldige of verlopen link faalt opslaan gegarandeerd: de
          enige zinvolle actie is 'Naar inloggen' in de melding hierboven. */}
      {!linkOngeldig && (
        <Button
          type="submit"
          className="careon-auth-btn careon-auth-btn-primary"
          data-busy={busy || undefined}
          disabled={busy || !password || !repeat}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Wachtwoord opslaan
        </Button>
      )}
    </form>
  );
}
