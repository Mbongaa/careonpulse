"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAREON_DEMO_CREDENTIALS, careonLogin } from "@/lib/careon-auth";
import { cn } from "@/lib/utils";

const INVALID_MESSAGE = "Onjuiste combinatie — probeer het opnieuw.";

export function CareonLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [shake, setShake] = useState(false);

  const canSubmit = username.trim() !== "" && password !== "" && !submitting;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setInvalid(false);

    window.setTimeout(() => {
      // Username is case-insensitive; the password stays case-sensitive.
      const ok =
        username.trim().toLowerCase() === CAREON_DEMO_CREDENTIALS.username.toLowerCase() &&
        password === CAREON_DEMO_CREDENTIALS.password;
      if (ok) {
        careonLogin();
        router.replace("/dashboard/directiecockpit");
        return;
      }
      setSubmitting(false);
      setInvalid(true);
      setShake(true);
      window.setTimeout(() => setShake(false), 550);
    }, 800);
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
        {invalid && (
          <p role="alert" className="text-destructive text-sm">
            {INVALID_MESSAGE}
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
