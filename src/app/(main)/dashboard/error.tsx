"use client";

import { useEffect } from "react";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle className="size-8 text-muted-foreground" />
      <h1 className="font-semibold text-xl">Er ging iets mis</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        Het dashboard kon dit onderdeel niet laden. Probeer het opnieuw; blijft dit gebeuren, neem dan contact op met uw
        Careon-contactpersoon.
      </p>
      <Button onClick={reset} variant="outline" size="sm">
        Opnieuw proberen
      </Button>
    </div>
  );
}
