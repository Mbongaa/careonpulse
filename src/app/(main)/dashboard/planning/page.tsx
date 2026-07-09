import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { PlanningContent } from "./_components/planning-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.planning.title,
  description: CAREON_PAGE_META.planning.sub,
};

export default function Page() {
  return <PlanningContent />;
}
