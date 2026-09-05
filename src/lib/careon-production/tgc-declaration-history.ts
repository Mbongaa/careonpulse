import type { DeclaratiesFacts } from "./types";

export interface FinanceDeclarationRow {
  invoiceNumber: string;
  invoiceDate: string;
  debtor: string;
  amount: string;
  awarded: string;
  debitCredit: "D" | "C";
  creditFor: string;
}

export interface DeclarationHistoryCandidate {
  fileName: string;
  facts: DeclaratiesFacts;
  modifiedAt: number;
}

export interface ReconciledDeclarationHistory {
  rows: FinanceDeclarationRow[];
  sourceFiles: string[];
}

function dutchFromIso(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function dutchMoney(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function invoiceKey(invoiceNumber: string, debtor: string): string {
  return `${invoiceNumber}|${debtor.toLowerCase()}`;
}

/**
 * Reconciles every validated declaration history instead of trusting only the
 * newest fallback snapshot. Newer snapshots win for invoices they contain;
 * older full exports may only fill a missing invoice. This prevents a fallback
 * generated from an already-partial fallback from silently shortening history.
 */
export function reconcileDeclarationHistory(
  currentRows: FinanceDeclarationRow[],
  currentStart: string,
  candidates: DeclarationHistoryCandidate[],
): ReconciledDeclarationHistory {
  const eligible = candidates
    .filter((candidate) => candidate.facts.bronVan < currentStart)
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.fileName.localeCompare(right.fileName));
  if (eligible.length === 0) {
    throw new Error(`Geen gevalideerde declaratiebasis gevonden voor de periode vóór ${currentStart}.`);
  }

  const currentInvoiceKeys = new Set(
    currentRows.filter((row) => row.debitCredit === "D").map((row) => invoiceKey(row.invoiceNumber, row.debtor)),
  );
  const historical = new Map<string, { sourceFile: string; rows: FinanceDeclarationRow[] }>();

  for (const candidate of eligible) {
    for (const invoice of candidate.facts.facturen) {
      const key = invoiceKey(invoice.nummer, invoice.koepel);
      if (currentInvoiceKeys.has(key) || historical.has(key)) continue;
      const rows: FinanceDeclarationRow[] = [
        {
          invoiceNumber: invoice.nummer,
          invoiceDate: dutchFromIso(invoice.datum),
          debtor: invoice.koepel,
          amount: dutchMoney(invoice.bedrag),
          awarded: dutchMoney(Math.max(0, invoice.bedrag - invoice.gecrediteerd)),
          debitCredit: "D",
          creditFor: "",
        },
      ];
      if (invoice.gecrediteerd > 0) {
        rows.push({
          invoiceNumber: `CARRY-${invoice.nummer}`,
          invoiceDate: dutchFromIso(invoice.datum),
          debtor: invoice.koepel,
          amount: dutchMoney(invoice.gecrediteerd),
          awarded: "0,00",
          debitCredit: "C",
          creditFor: invoice.nummer,
        });
      }
      historical.set(key, { sourceFile: candidate.fileName, rows });
    }
  }

  return {
    rows: [...historical.values()].flatMap((entry) => entry.rows),
    sourceFiles: [...new Set([...historical.values()].map((entry) => entry.sourceFile))],
  };
}
