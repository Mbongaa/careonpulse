"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center space-y-2 text-center">
      <h1 className="font-semibold text-2xl">Pagina niet gevonden</h1>
      <p className="text-muted-foreground">De pagina die u zoekt bestaat niet.</p>
      <Link prefetch={false} replace href="/dashboard/directiecockpit">
        <Button variant="outline">Terug naar het dashboard</Button>
      </Link>
    </div>
  );
}
