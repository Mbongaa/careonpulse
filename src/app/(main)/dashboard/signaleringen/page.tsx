import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { getCareonOperationsStatus } from "@/lib/careon-operations/operations-status.server";
import { getCareonSession } from "@/lib/supabase/session.server";

import { SignaleringenContent } from "./_components/signaleringen-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.signaleringen.title,
  description: CAREON_PAGE_META.signaleringen.sub,
};

export default async function Page() {
  const session = await getCareonSession();
  const operationsStatus = session.status === "ok" ? await getCareonOperationsStatus(session.session) : null;
  return <SignaleringenContent operationsStatus={operationsStatus} />;
}
