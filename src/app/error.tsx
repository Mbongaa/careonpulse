"use client";

import { useEffect } from "react";

export default function GlobalSegmentError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-center text-foreground">
      <h1 className="font-semibold text-xl">Er ging iets mis</h1>
      <p className="max-w-md text-muted-foreground text-sm">De pagina kon niet worden geladen.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
      >
        Opnieuw proberen
      </button>
    </div>
  );
}
