import type { Metadata } from "next";

import { SCRIBE_PAGE_META } from "@/data/careon/careon-scribe";
import { requireScribePage } from "@/lib/supabase/session.server";

import { ConsultWerkruimte } from "../_components/consult-werkruimte";

export const metadata: Metadata = {
  title: SCRIBE_PAGE_META.werkruimte.title,
  description: SCRIBE_PAGE_META.werkruimte.sub,
};

export default async function ScribeConsultPage({ params }: Readonly<{ params: Promise<{ sessieId: string }> }>) {
  await requireScribePage();
  const { sessieId } = await params;
  return <ConsultWerkruimte sessieId={sessieId} />;
}
