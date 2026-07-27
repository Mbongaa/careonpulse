"use client";

import { useState } from "react";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

// Eénmalige wachtwoord-link, persoonlijk door te geven (variant A). De link is
// beperkt geldig — verlopen? Genereer bij het lid een nieuwe.
export function WachtwoordLink({ link }: Readonly<{ link: string }>) {
  const [copied, setCopied] = useState(false);

  async function kopieer() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard geweigerd (bijv. http): de link blijft selecteerbaar staan.
    }
  }

  return (
    <div className="w-full space-y-1.5 rounded-lg border bg-muted/30 p-3">
      <p className="font-medium text-sm">Wachtwoord-link — geef deze persoonlijk door:</p>
      <p className="select-all break-all font-mono text-muted-foreground text-xs">{link}</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void kopieer()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Gekopieerd" : "Kopieer link"}
        </Button>
        <span className="text-muted-foreground text-xs">
          De ontvanger kiest er zelf een wachtwoord mee; de link is beperkt geldig.
        </span>
      </div>
    </div>
  );
}
