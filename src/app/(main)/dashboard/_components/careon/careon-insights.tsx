"use client";

import { type ReactNode, useState } from "react";

import { Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CareonInsights({ messages, badge }: Readonly<{ messages: string[]; badge?: ReactNode }>) {
  const [active, setActive] = useState(0);
  // De berichtenlijst is afgeleid (productie-snapshot, HR-staat) en kan krimpen
  // terwijl een latere bolletje geselecteerd staat — dan zou de kaart leeg zijn.
  const index = Math.min(active, Math.max(messages.length - 1, 0));

  if (messages.length === 0) {
    return null;
  }

  return (
    <Card className="careon-insights-card py-4">
      <CardContent className="flex items-start gap-3 px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Careon Insights
            {badge}
          </p>
          <p className="text-sm">{messages[index]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-center">
          {messages.map((message, dot) => (
            <button
              key={message}
              type="button"
              aria-label={`Insight ${dot + 1}`}
              aria-pressed={dot === index}
              onClick={() => setActive(dot)}
              className={cn(
                "size-2 rounded-full transition-colors",
                dot === index ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
