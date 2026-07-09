import { cn } from "@/lib/utils";

export function CareonLogo({
  compact,
  className,
}: Readonly<{
  compact?: boolean;
  className?: string;
}>) {
  return (
    <span className={cn("careon-brand flex min-w-0 items-center gap-3", className)}>
      <span className="careon-logo-mark flex size-8 shrink-0 items-center justify-center rounded-lg">
        <svg aria-hidden="true" viewBox="0 0 32 32" className="size-6">
          <path
            d="M4.5 16h5.2l2.6-6.8 5.2 15.6 3.3-8.8h6.7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.6"
          />
        </svg>
      </span>
      {!compact && (
        <span className="careon-brand-copy min-w-0 leading-none group-data-[collapsible=icon]:hidden">
          <span className="careon-wordmark block truncate font-semibold text-base">Careon Pulse</span>
          <span className="careon-tagline mt-1 block truncate text-[8px] uppercase tracking-[0.22em]">
            Technology
            {" \u00b7 "}
            Growth
            {" \u00b7 "}
            Care
          </span>
        </span>
      )}
    </span>
  );
}
