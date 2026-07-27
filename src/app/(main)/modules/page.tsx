import type { Metadata } from "next";

import { CareonAuthGuard } from "@/app/(main)/dashboard/_components/careon/careon-auth-guard";

import { ModuleLauncher } from "./_components/module-launcher";

export const metadata: Metadata = {
  title: "Modules",
  description: "Kies een module binnen de Careon Pulse-omgeving van TGC Groep.",
};

export default function Page() {
  return (
    <CareonAuthGuard>
      <ModuleLauncher />
    </CareonAuthGuard>
  );
}
