import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CareonChartCard({
  title,
  sub,
  action,
  footer,
  children,
  className,
}: Readonly<{
  title: string;
  sub?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <Card className={cn("careon-chart-card @container/card", className)}>
      <CardHeader>
        <CardTitle className="leading-none">{title}</CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      {footer && <CardFooter className="text-muted-foreground text-xs">{footer}</CardFooter>}
    </Card>
  );
}
