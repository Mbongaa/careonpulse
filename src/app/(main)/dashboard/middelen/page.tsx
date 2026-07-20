import type { Metadata } from "next";

import { MiddelenContent } from "./_components/middelen-content";

export const metadata: Metadata = {
  title: "Medewerkers & middelen",
  description: "Functie, talen en uitgegeven middelen per medewerker — plus de inventaris per locatie.",
};

export default function MiddelenPage() {
  return <MiddelenContent />;
}
