"use client";

import { type ReactNode, useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import DashboardLoading from "@/app/(main)/dashboard/loading";
import { CAREON_LOGIN_ROUTE, isCareonAuthed } from "@/lib/careon-auth";

// Sessiepoort. De server beslist altijd eerst: 200 = echte sessie; uitsluitend
// 501 + demo:true mag de lokale sessionStorage-vlag gebruiken. Daardoor kan
// een clientvlag echte auth nooit omzeilen en faalt ontbrekende config gesloten.

// Drie standen i.p.v. authed ja/nee: de hele shell (sidebar, header, children
// én de route-skeleton) hangt binnen deze poort, dus "nog niet beslist" gaf
// een blanco pagina bij elke harde refresh of deeplink — zolang de sessie-
// probe loopt (auth-call + twee tabelqueries).
type Poortstatus = "wacht" | "toegang" | "geweigerd";

export function CareonAuthGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [status, setStatus] = useState<Poortstatus>("wacht");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          setStatus("toegang");
          return;
        }
        if (response.status === 501) {
          const payload = (await response.json().catch(() => null)) as { demo?: boolean } | null;
          if (payload?.demo === true && isCareonAuthed()) {
            setStatus("toegang");
            return;
          }
        }
        setStatus("geweigerd");
        router.replace(CAREON_LOGIN_ROUTE);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("geweigerd");
          router.replace(CAREON_LOGIN_ROUTE);
        }
      });
    return () => {
      controller.abort();
    };
  }, [router]);

  if (status === "wacht") {
    return (
      <div aria-busy="true" className="p-4 md:p-6">
        <DashboardLoading />
      </div>
    );
  }

  // Geweigerd: leeg laten tot de doorverwijzing naar login is afgerond.
  if (status === "geweigerd") {
    return null;
  }

  return <>{children}</>;
}
