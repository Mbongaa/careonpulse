import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { HrContent } from "./_components/hr-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.hr.title,
  description: CAREON_PAGE_META.hr.sub,
};

export default function Page() {
  return <HrContent />;
}
