"use client";

import { useState } from "react";

import { WachtwoordLink } from "@/app/(main)/dashboard/_components/careon/wachtwoord-link";
import { Button } from "@/components/ui/button";

import type { OrgMember } from "./beheer-content";

// Acties per lid: wachtwoord-link genereren (gebruiker kiest zelf, variant A)
// en (de)blokkeren. Platformbeheerders en het eigen account zijn geen doelwit —
// de route weigert ze óók server-side.
export function MemberActions({ member, onChanged }: Readonly<{ member: OrgMember; onChanged: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const beschermd = member.isPlatformAdmin;

  async function call(body: Record<string, unknown>, confirmText?: string) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    setInviteLink(null);
    try {
      const response = await fetch("/api/org/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId, ...body }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        inviteLink?: string | null;
      } | null;
      if (!response.ok) {
        setMessage(payload?.error ?? "Actie mislukt.");
        return;
      }
      if (payload?.inviteLink) {
        setInviteLink(payload.inviteLink);
      } else {
        setMessage("Gelukt.");
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (beschermd) {
    return <span className="text-muted-foreground text-xs">Beheer via platformbeheer</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void call({ action: "invite_link" })}>
        Wachtwoord-link
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || member.isSelf}
        onClick={() =>
          void call(
            { action: member.banned ? "unban" : "ban" },
            member.banned ? undefined : `${member.email} blokkeren? De gebruiker kan dan niet meer inloggen.`,
          )
        }
      >
        {member.banned ? "Deblokkeer" : "Blokkeer"}
      </Button>
      {message && <span className="text-muted-foreground text-xs">{message}</span>}
      {inviteLink && <WachtwoordLink link={inviteLink} />}
    </div>
  );
}
