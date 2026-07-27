"use client";

import { type ReactNode, useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { CAREON_LOGIN_ROUTE, isCareonAuthed } from "@/lib/careon-auth";

// Sessiepoort. De server beslist altijd eerst: 200 = echte sessie; uitsluitend
// 501 + demo:true mag de lokale sessionStorage-vlag gebruiken. Daardoor kan
// een clientvlag echte auth nooit omzeilen en faalt ontbrekende config gesloten.
export function CareonAuthGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          setAuthed(true);
          return;
        }
        if (response.status === 501) {
          const payload = (await response.json().catch(() => null)) as { demo?: boolean } | null;
          if (payload?.demo === true && isCareonAuthed()) {
            setAuthed(true);
            return;
          }
        }
        router.replace(CAREON_LOGIN_ROUTE);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          router.replace(CAREON_LOGIN_ROUTE);
        }
      });
    return () => {
      controller.abort();
    };
  }, [router]);

  if (!authed) {
    return null;
  }

  return <>{children}</>;
}
