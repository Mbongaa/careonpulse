"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

export function CareonDonut({
  data,
  suffix = "",
  height = 180,
}: Readonly<{ data: DonutSlice[]; suffix?: string; height?: number }>) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            cursor={false}
            formatter={(value) => `${Number(value).toLocaleString("nl-NL")}${suffix}`}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            strokeWidth={2}
            stroke="var(--card)"
          >
            {data.map((slice) => (
              <Cell key={slice.name} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CareonDonutLegend({ data, suffix = "" }: Readonly<{ data: DonutSlice[]; suffix?: string }>) {
  return (
    <div className="space-y-2">
      {data.map((slice) => (
        <div key={slice.name} className="flex items-center gap-2 text-sm">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
          <span className="min-w-0 flex-1 truncate">{slice.name}</span>
          <span className="font-medium tabular-nums">
            {slice.value.toLocaleString("nl-NL")}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}
