import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { KPI_DETAIL_BY_ID, KPI_DETAILS } from "@/data/careon/careon-kpi-details";

import { KpiDetailContent } from "./_components/kpi-detail-content";

// Alle detailpagina's zijn statisch bekend uit het register; onbekende ids
// geven een echte 404 (consistent met de bestaande not-found-e2e).
export const dynamicParams = false;

export function generateStaticParams(): { kpiId: string }[] {
  return KPI_DETAILS.map((entry) => ({ kpiId: entry.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ kpiId: string }> }): Promise<Metadata> {
  const { kpiId } = await params;
  const entry = KPI_DETAIL_BY_ID.get(kpiId);
  if (!entry) {
    return {};
  }
  return { title: entry.title, description: entry.sub };
}

export default async function Page({ params }: { params: Promise<{ kpiId: string }> }) {
  const { kpiId } = await params;
  if (!KPI_DETAIL_BY_ID.has(kpiId)) {
    notFound();
  }
  return <KpiDetailContent kpiId={kpiId} />;
}
