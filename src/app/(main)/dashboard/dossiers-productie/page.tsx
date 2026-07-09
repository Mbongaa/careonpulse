import type { Metadata } from "next";

import { DossiersProductieContent } from "./_components/dossiers-productie-content";

export const metadata: Metadata = {
  title: "Dossiers & productie",
  description: "Dossiers, afsluitingen en productie per medewerker — plus de cliëntpopulatie in één oogopslag.",
};

export default function DossiersProductiePage() {
  return <DossiersProductieContent />;
}
