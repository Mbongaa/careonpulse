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
  titleBadge,
}: Readonly<{
  title: string;
  sub?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  titleBadge?: ReactNode;
}>) {
  return (
    <Card className={cn("careon-chart-card @container/card", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 leading-none">
          {title}
          {titleBadge}
        </CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      {footer && <CardFooter className="text-muted-foreground text-xs">{footer}</CardFooter>}
    </Card>
  );
}
