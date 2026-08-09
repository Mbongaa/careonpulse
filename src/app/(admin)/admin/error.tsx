"use client";

import { useEffect, useTransition } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  // reset() alléén wist alleen de boundary-state en rendert dezelfde mislukte
  // servercomponent opnieuw uit de cache — de knop deed dan niets. Eerst
  // router.refresh() zodat de data écht opnieuw wordt opgehaald, en pas daarna
  // de boundary sluiten.
  function opnieuw() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle className="size-8 text-muted-foreground" />
      <h1 className="font-semibold text-xl">Beheer kon niet worden geladen</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        De beheergegevens konden niet worden opgehaald. Controleer de verbinding met Supabase en probeer het opnieuw.
      </p>
      <Button onClick={opnieuw} disabled={pending} variant="outline" size="sm">
        {pending && <Loader2 className="size-4 animate-spin" />}
        Opnieuw proberen
      </Button>
    </div>
  );
}
