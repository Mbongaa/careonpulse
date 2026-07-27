import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { getCareonSession } from "@/lib/supabase/session.server";

import { BeheerContent } from "./_components/beheer-content";

export const metadata: Metadata = {
  title: "Gebruikersbeheer",
  description: "Accounts van uw organisatie aanmaken en beheren.",
};

export default async function Page() {
  // Server-side rolgate (defense-in-depth naast de 403 van /api/org/members):
  // gewone leden horen deze pagina niet te bereiken. Demo- en configuratie-
  // statussen vallen door naar de client, die er een nette uitleg voor toont.
  const result = await getCareonSession();
  if (result.status === "ok" && result.session.orgRole !== "org_admin" && !result.session.isSuperadmin) {
    redirect("/dashboard/directiecockpit");
  }
  return <BeheerContent />;
}
