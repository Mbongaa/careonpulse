import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { FinancieelContent } from "./_components/financieel-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.financieel.title,
  description: CAREON_PAGE_META.financieel.sub,
};

export default function Page() {
  return <FinancieelContent />;
}
