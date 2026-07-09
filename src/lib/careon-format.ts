import type { CareonKpiFormat, CareonMetric } from "@/data/careon/careon-types";

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatCareonValue(value: number, f: CareonKpiFormat): string {
  switch (f) {
    case "int":
      return nl.format(Math.round(value));
    case "pct":
      return `${nlDec1.format(value)}%`;
    case "pct0":
      return `${nl.format(Math.round(value))}%`;
    case "dec1":
      return nlDec1.format(value);
    case "eurK":
      return `€ ${nl.format(Math.round(value / 1000))}K`;
    case "eur":
      return `€ ${nl.format(Math.round(value))}`;
  }
}

export type DeltaTone = "good" | "bad" | "neutral";

export interface CareonDelta {
  text: string;
  tone: DeltaTone;
  up: boolean;
}

// Delta rendering mirrors the audited dashboard: monetary values and large
// counters show a percentage change, small counters an absolute change, and
// percentage/score KPIs a change in points.
export function formatCareonDelta(
  m: Pick<CareonMetric, "value" | "prev" | "f" | "betterLow" | "neutralDown">,
): CareonDelta {
  const diff = m.value - m.prev;
  const up = diff >= 0;
  const sign = up ? "+" : "-";
  let text: string;

  if (m.f === "eurK" || m.f === "eur" || (m.f === "int" && m.value >= 500)) {
    const pct = m.prev === 0 ? 0 : (diff / m.prev) * 100;
    text = `${sign}${nlDec1.format(Math.abs(pct))}%`;
  } else if (m.f === "int") {
    text = `${sign}${nl.format(Math.abs(Math.round(diff)))}`;
  } else if (m.f === "pct0") {
    text = `${sign}${nl.format(Math.abs(Math.round(diff)))} pt`;
  } else {
    text = `${sign}${nlDec1.format(Math.abs(diff))}`;
  }

  let tone: DeltaTone;
  if (diff === 0) {
    tone = "neutral";
  } else if (m.neutralDown && diff < 0) {
    tone = "neutral";
  } else if (m.betterLow) {
    tone = diff < 0 ? "good" : "bad";
  } else {
    tone = diff > 0 ? "good" : "bad";
  }

  return { text, tone, up };
}
