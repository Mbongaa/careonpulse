import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { PatientenContent } from "./_components/patienten-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.patienten.title,
  description: CAREON_PAGE_META.patienten.sub,
};

export default function Page() {
  return <PatientenContent />;
}
