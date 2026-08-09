import type { ReactNode } from "react";

import Link from "next/link";
import { redirect } from "next/navigation";

import { ShieldCheck } from "lucide-react";

import { getCareonSession } from "@/lib/supabase/session.server";

import { AdminNav } from "./_components/admin-nav";
import { AdminUitloggen } from "./_components/admin-uitloggen";

// Beheerlaag (handoff 13, fase 4): alleen platformbeheerders. De proxy eist al
// een sessie voor /admin; deze server-side check dwingt de superadmin-rol af —
// zonder rol (of in demo-modus, waar geen beheer bestaat) ga je terug naar het
// gewone dashboard.
export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const result = await getCareonSession();
  if (result.status !== "ok" || !result.session.isSuperadmin) {
    redirect("/dashboard/directiecockpit");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="size-6 text-primary" />
          <div>
            <h1 className="font-semibold text-lg leading-tight">Careon Beheer</h1>
            <p className="text-muted-foreground text-xs">Platformbeheer · ingelogd als {result.session.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            href="/dashboard/directiecockpit"
          >
            Naar dashboard
          </Link>
          <AdminUitloggen />
        </div>
      </header>
      <AdminNav />
      <main className="flex flex-1 flex-col gap-6 pb-10">{children}</main>
    </div>
  );
}
