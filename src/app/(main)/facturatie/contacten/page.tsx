import type { Metadata } from "next";

import { FACTURATIE_PAGE_META } from "@/data/careon/careon-facturatie";
import { requireFacturatiePage } from "@/lib/supabase/session.server";

import { ContactenContent } from "../_components/contacten-content";

export const metadata: Metadata = {
  title: FACTURATIE_PAGE_META.contacten.title,
  description: FACTURATIE_PAGE_META.contacten.sub,
};

export default async function FacturatieContactenPage() {
  await requireFacturatiePage();
  return <ContactenContent />;
}
