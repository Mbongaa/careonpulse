"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useCareon } from "./careon-provider";

const DOT_CLASSES = {
  demo: "bg-amber-500",
  csv: "bg-blue-500",
  api: "bg-sky-500",
  productie: "bg-violet-500",
};

export function CareonSourceStatus({ className }: Readonly<{ className?: string }>) {
  const { source } = useCareon();

  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
      <span className={cn("size-1.5 rounded-full", DOT_CLASSES[source.mode])} />
      {source.label}
    </Badge>
  );
}
