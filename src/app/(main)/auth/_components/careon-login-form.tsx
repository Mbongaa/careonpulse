"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAREON_SIGNIN_MESSAGES, careonPostLoginRoute, careonSignIn } from "@/lib/careon-auth";
import { cn } from "@/lib/utils";

function MicrosoftMark() {
  return (
    <span aria-hidden="true" className="careon-auth-ms-mark grid grid-cols-2">
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}

export function CareonLoginForm({
  initiallyUnavailable = false,
  initialErrorMessage = "",
  microsoftEnabled = false,
}: Readonly<{ initiallyUnavailable?: boolean; initialErrorMessage?: string; microsoftEnabled?: boolean }>) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  let initialMessage = initialErrorMessage;
  if (initialMessage === "" && initiallyUnavailable) {
    initialMessage = CAREON_SIGNIN_MESSAGES.unavailable;
  }
  const [errorMessage, setErrorMessage] = useState(initialMessage);
  const [shake, setShake] = useState(false);

  const canSubmit = username.trim() !== "" && password !== "" && !submitting;
  let submitLabel = microsoftEnabled ? "Inloggen met wachtwoord" : "Inloggen";
  if (submitting) submitLabel = "Bezig met inloggen...";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setInvalid(false);
    setErrorMessage("");

    // Supabase-modus: echte login via de server. Demo-modus: de
    // oorspronkelijke lokale controle (met de geauditeerde laadtoestand).
    const result = await careonSignIn(username, password);
    if (result === "ok") {
      router.replace(await careonPostLoginRoute());
      return;
    }
    setSubmitting(false);
    // Alleen een échte combinatiefout markeert de velden rood: bij "no-org"
    // klopten de gegevens wél, dan helpt herinvoeren de gebruiker niet.
    setInvalid(result === "invalid");
    setErrorMessage(CAREON_SIGNIN_MESSAGES[result]);
    if (result === "invalid") {
      setShake(true);
      window.setTimeout(() => setShake(false), 550);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="careon-auth-form">
      {microsoftEnabled && (
        <>
          <Button asChild type="button" className="careon-auth-btn careon-auth-btn-primary">
            <a href="/api/auth/microsoft" aria-describedby="careon-microsoft-hint">
              <MicrosoftMark />
              Inloggen met Microsoft
            </a>
          </Button>
          <p id="careon-microsoft-hint" className="careon-auth-hint text-center">
            Aanbevolen voor medewerkers · gebruik uw Microsoft 365-werkaccount
          </p>
          <div className="careon-auth-divider" aria-hidden="true">
            <span className="careon-auth-divider-rule" />
            <span className="careon-auth-divider-label">BEHEER OF UITZONDERING</span>
            <span className="careon-auth-divider-rule" />
          </div>
        </>
      )}
      <div className={cn("careon-auth-fields", shake && "careon-shake")}>
        <div className="careon-auth-field">
          <Label className="careon-auth-label" htmlFor="careon-username">
            Gebruikersnaam
          </Label>
          <Input
            id="careon-username"
            placeholder="Gebruikersnaam"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setInvalid(false);
              setErrorMessage("");
            }}
            aria-invalid={invalid}
            className={cn("careon-auth-input", invalid && "careon-auth-input-invalid")}
          />
        </div>
        <div className="careon-auth-field">
          <Label className="careon-auth-label" htmlFor="careon-password">
            Wachtwoord
          </Label>
          <div className="careon-auth-input-wrap">
            <Input
              id="careon-password"
              type={showPassword ? "text" : "password"}
              placeholder="Wachtwoord"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setInvalid(false);
                setErrorMessage("");
              }}
              aria-invalid={invalid}
              className={cn("careon-auth-input careon-auth-input-eye", invalid && "careon-auth-input-invalid")}
            />
            <button
              type="button"
              aria-label={showPassword ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
              className="careon-auth-eye"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        {errorMessage && (
          <p role="alert" className="careon-auth-error">
            <span aria-hidden="true" className="careon-auth-error-dot" />
            {errorMessage}
          </p>
        )}
      </div>
      <Button
        className={cn("careon-auth-btn", microsoftEnabled ? "careon-auth-btn-secondary" : "careon-auth-btn-primary")}
        type="submit"
        data-busy={submitting || undefined}
        disabled={!canSubmit}
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}
