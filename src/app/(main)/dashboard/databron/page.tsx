import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { DatabronContent } from "./_components/databron-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.databron.title,
  description: CAREON_PAGE_META.databron.sub,
};

export default function Page() {
  return <DatabronContent />;
}
