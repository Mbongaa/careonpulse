import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="font-semibold text-2xl">Pagina niet gevonden</h1>
      <p className="text-muted-foreground">Dit dashboardonderdeel bestaat niet.</p>
      <Button asChild variant="outline">
        <Link prefetch={false} replace href="/dashboard/directiecockpit">
          Naar de Directiecockpit
        </Link>
      </Button>
    </div>
  );
}
