import type { Metadata } from "next";

import { FACTURATIE_PAGE_META } from "@/data/careon/careon-facturatie";
import { mailBeschikbaar } from "@/lib/careon-facturatie/mail.server";
import { requireFacturatiePage } from "@/lib/supabase/session.server";

import { InstellingenForm } from "../_components/instellingen-form";

export const metadata: Metadata = {
  title: FACTURATIE_PAGE_META.instellingen.title,
  description: FACTURATIE_PAGE_META.instellingen.sub,
};

export default async function FacturatieInstellingenPage() {
  await requireFacturatiePage();
  return <InstellingenForm mailVerzendingActief={mailBeschikbaar()} />;
}
