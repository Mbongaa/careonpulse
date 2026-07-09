"use client";

import { type ReactNode, useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { CAREON_LOGIN_ROUTE, isCareonAuthed } from "@/lib/careon-auth";

// Demo session gate: the dashboard renders only with an active session flag.
export function CareonAuthGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (isCareonAuthed()) {
      setAuthed(true);
    } else {
      router.replace(CAREON_LOGIN_ROUTE);
    }
  }, [router]);

  if (!authed) {
    return null;
  }

  return <>{children}</>;
}
