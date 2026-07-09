import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { DirectiecockpitContent } from "./_components/directiecockpit-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.cockpit.title,
  description: CAREON_PAGE_META.cockpit.sub,
};

export default function Page() {
  return <DirectiecockpitContent />;
}
