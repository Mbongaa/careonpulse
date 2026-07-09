import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { BehandelarenContent } from "./_components/behandelaren-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.behandelaren.title,
  description: CAREON_PAGE_META.behandelaren.sub,
};

export default function Page() {
  return <BehandelarenContent />;
}
