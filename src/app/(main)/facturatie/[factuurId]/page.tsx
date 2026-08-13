import type { Metadata } from "next";

import { FACTURATIE_PAGE_META } from "@/data/careon/careon-facturatie";
import { requireFacturatiePage } from "@/lib/supabase/session.server";

import { FactuurEditor } from "../_components/factuur-editor";

export const metadata: Metadata = {
  title: FACTURATIE_PAGE_META.factuur.title,
  description: FACTURATIE_PAGE_META.factuur.sub,
};

export default async function FactuurPage({ params }: Readonly<{ params: Promise<{ factuurId: string }> }>) {
  await requireFacturatiePage();
  const { factuurId } = await params;
  return <FactuurEditor factuurId={factuurId} />;
}
