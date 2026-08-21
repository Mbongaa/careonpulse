"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { CAREON_SIGNIN_MESSAGES, careonPostLoginRoute, careonSignIn } from "@/lib/careon-auth";
import { cn } from "@/lib/utils";

function MicrosoftMark() {
  return (
    <span aria-hidden="true" className="grid size-4 grid-cols-2 gap-px">
      <span className="bg-red-500" />
      <span className="bg-green-500" />
      <span className="bg-blue-500" />
      <span className="bg-yellow-400" />
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
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {microsoftEnabled && (
        <>
          <Button asChild type="button" variant="outline" size="lg" className="w-full">
            <a href="/api/auth/microsoft">
              <MicrosoftMark />
              Inloggen met Microsoft
            </a>
          </Button>
          <div className="flex items-center gap-3 text-muted-foreground text-xs" aria-hidden="true">
            <Separator className="flex-1" />
            <span>of met wachtwoord</span>
            <Separator className="flex-1" />
          </div>
        </>
      )}
      <div className={cn("flex flex-col gap-4", shake && "careon-shake")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="careon-username">Gebruikersnaam</Label>
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
            className={cn(invalid && "border-destructive focus-visible:ring-destructive")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="careon-password">Wachtwoord</Label>
          <div className="relative">
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
              className={cn("pr-10", invalid && "border-destructive focus-visible:ring-destructive")}
            />
            <button
              type="button"
              aria-label="Wachtwoord tonen"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        {errorMessage && (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage}
          </p>
        )}
      </div>
      <Button className="w-full" type="submit" disabled={!canSubmit}>
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? "Bezig met inloggen..." : "Inloggen"}
      </Button>
    </form>
  );
}
