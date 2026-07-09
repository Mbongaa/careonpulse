import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { SignaleringenContent } from "./_components/signaleringen-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.signaleringen.title,
  description: CAREON_PAGE_META.signaleringen.sub,
};

export default function Page() {
  return <SignaleringenContent />;
}
