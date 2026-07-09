"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

export function CareonSparkline({ data, className }: Readonly<{ data: number[]; className?: string }>) {
  const points = data.map((value, index) => ({ index, value }));

  return (
    <div className={className ?? "h-9 w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--primary)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
