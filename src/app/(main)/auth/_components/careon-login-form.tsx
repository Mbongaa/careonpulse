"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { careonSignIn } from "@/lib/careon-auth";
import { cn } from "@/lib/utils";

const INVALID_MESSAGE = "Onjuiste combinatie — probeer het opnieuw.";
const UNAVAILABLE_MESSAGE = "Inloggen is tijdelijk niet beschikbaar — probeer het later opnieuw.";

export function CareonLoginForm({ initiallyUnavailable = false }: Readonly<{ initiallyUnavailable?: boolean }>) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [errorMessage, setErrorMessage] = useState(initiallyUnavailable ? UNAVAILABLE_MESSAGE : "");
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
      router.replace("/dashboard/directiecockpit");
      return;
    }
    setSubmitting(false);
    setInvalid(result === "invalid");
    setErrorMessage(result === "invalid" ? INVALID_MESSAGE : UNAVAILABLE_MESSAGE);
    if (result === "invalid") {
      setShake(true);
      window.setTimeout(() => setShake(false), 550);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
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
