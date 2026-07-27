"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isCareonHostedDemoEmail } from "@/lib/careon-demo-account";
import { CAREON_PASSWORD_HINT, isStrongCareonPassword } from "@/lib/careon-password";

export function UserActions({ userId, email, banned }: Readonly<{ userId: string; email: string; banned: boolean }>) {
  const router = useRouter();
  const protectedDemoAccount = isCareonHostedDemoEmail(email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(body: Record<string, unknown>, confirmText?: string) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(response.ok ? "Gelukt." : (payload?.error ?? "Actie mislukt."));
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function resetPassword() {
    const password = window.prompt(`Nieuw wachtwoord voor ${email}. ${CAREON_PASSWORD_HINT}`);
    if (!password) return;
    if (!isStrongCareonPassword(password)) {
      setMessage(CAREON_PASSWORD_HINT);
      return;
    }
    void call({ action: "reset_password", password });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={busy || protectedDemoAccount} onClick={resetPassword}>
        Wachtwoord
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || (protectedDemoAccount && !banned)}
        onClick={() =>
          call(
            { action: banned ? "unban" : "ban" },
            banned ? undefined : `${email} blokkeren? De gebruiker kan dan niet meer inloggen.`,
          )
        }
      >
        {banned ? "Deblokkeer" : "Blokkeer"}
      </Button>
      {protectedDemoAccount && <span className="text-muted-foreground text-xs">Vast demoaccount</span>}
      {message && <span className="text-muted-foreground text-xs">{message}</span>}
    </div>
  );
}
