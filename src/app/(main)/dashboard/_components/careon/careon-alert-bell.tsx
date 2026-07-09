"use client";

import Link from "next/link";

import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useCareon } from "./careon-provider";

export function CareonAlertBell() {
  const { alertCount } = useCareon();

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link prefetch={false} href="/dashboard/signaleringen" aria-label={`Signaleringen (${alertCount} kritiek)`}>
        <Bell className="size-4" />
        {alertCount > 0 && (
          <span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-red-500 font-medium text-[9px] text-white">
            {alertCount}
          </span>
        )}
      </Link>
    </Button>
  );
}
