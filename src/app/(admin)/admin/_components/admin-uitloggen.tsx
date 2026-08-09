"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CAREON_LOGIN_ROUTE, careonLogoutMetSignaal } from "@/lib/careon-auth";
import { meldOnbewaardeRegistraties } from "@/lib/careon-uitlog-melding.client";

/**
 * Uitloggen vanuit de beheerschil. /admin is voor een platformbeheerder de
 * landingsplek na inloggen, maar de sessie was er niet te beëindigen: daarvoor
 * moest je eerst naar het dashboard en daar het gebruikersmenu openen — op een
 * gedeelde werkplek precies de omweg die niet genomen wordt. Zelfde route en
 * zelfde waarschuwing als de andere uitlogpunten.
 */
export function AdminUitloggen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function uitloggen() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, onbewaard } = await careonLogoutMetSignaal();
      if (!ok) {
        toast.error("Uitloggen is niet voltooid. Probeer het opnieuw.");
        return;
      }
      meldOnbewaardeRegistraties(onbewaard);
      router.replace(CAREON_LOGIN_ROUTE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={uitloggen}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Uitloggen
    </Button>
  );
}
