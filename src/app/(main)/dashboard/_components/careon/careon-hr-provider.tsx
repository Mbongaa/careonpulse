"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { HR_SEED_STATE } from "@/data/careon/careon-hr";
import { fetchRemoteHrState, pushRemoteHrState } from "@/lib/careon-hr/remote.client";
import { loadHrCache, saveHrState } from "@/lib/careon-hr/storage.client";
import {
  HR_LIMITS,
  type HrChangeAudit,
  type HrKpiId,
  type HrState,
  isHrIsoDate,
  normalizeHrKpiValue,
} from "@/lib/careon-hr/types";

// Handmatig bijgehouden HR-registratie (handoff 12). Eén administratie los van
// de databron: opgeslagen staat wint altijd; zonder opgeslagen staat toont de
// pagina de geauditeerde seed. Elke wijziging gaat direct naar localStorage en
// met een korte debounce naar de centrale Supabase-opslag (of blijft lokaal
// wanneer die niet is geconfigureerd — de route antwoordt dan 501). De
// sync-machinerie (revisies, idempotentie, conflict) is gelijk aan middelen.

export type HrSyncStatus = "laden" | "centraal" | "lokaal" | "fout" | "conflict";

interface CareonHrContextValue {
  state: HrState;
  syncStatus: HrSyncStatus;
  retrySync: () => void;
  resolveConflict: (keuze: "centraal" | "lokaal") => void;
  hasCentralConflictVersion: boolean;
  setKpi: (id: HrKpiId, veld: "value" | "prev", waarde: number) => void;
  setTrendPunt: (index: number, waarde: number) => void;
  setBenchmark: (waarde: number) => void;
  setBigVeld: (index: number, veld: "naam" | "functie" | "verloopt", waarde: string) => void;
  addBig: (naam: string, functie: string, verloopt: string) => boolean;
  removeBig: (index: number) => void;
}

const CareonHrContext = createContext<CareonHrContextValue | null>(null);

export function useCareonHr(): CareonHrContextValue {
  const ctx = useContext(CareonHrContext);
  if (!ctx) {
    throw new Error("useCareonHr must be used within a CareonHrProvider");
  }
  return ctx;
}

const PUSH_DEBOUNCE_MS = 800;
const PULL_INTERVAL_MS = 15_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

function mergeAudit(huidig: HrChangeAudit | null, volgend: HrChangeAudit): HrChangeAudit {
  if (!huidig) return volgend;
  return {
    source: huidig.source === "assistant" || volgend.source === "assistant" ? "assistant" : "manual",
    toolNames: [...new Set([...(huidig.toolNames ?? []), ...(volgend.toolNames ?? [])])],
    requestIds: [...new Set([...(huidig.requestIds ?? []), ...(volgend.requestIds ?? [])])],
  };
}

export function CareonHrProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [stored, setStored] = useState<HrState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<HrSyncStatus>("laden");
  const [conflictState, setConflictState] = useState<{ state: HrState | null; revision: number } | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const generationRef = useRef(0);
  const pendingOperationRef = useRef<string | null>(null);
  const pendingAuditRef = useRef<HrChangeAudit | null>(null);
  const pushingRef = useRef(false);
  const conflictRef = useRef<typeof conflictState>(null);
  const centralConfiguredRef = useRef(false);
  const mountedRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);

  const state = useMemo(() => stored ?? HR_SEED_STATE, [stored]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const schedulePushRef = useRef<() => void>(() => undefined);
  const scheduleRetryRef = useRef<() => void>(() => undefined);

  const flushPending = useCallback(async () => {
    if (pushingRef.current || conflictRef.current || !dirtyRef.current) return;
    pushingRef.current = true;
    const snapshot = stateRef.current;
    const generation = generationRef.current;
    const operationId = pendingOperationRef.current ?? crypto.randomUUID();
    const audit = pendingAuditRef.current ?? { source: "manual" as const };
    pendingOperationRef.current = null;
    pendingAuditRef.current = null;

    const result = await pushRemoteHrState(snapshot, { baseRevision: revisionRef.current, operationId, audit });
    pushingRef.current = false;
    if (!mountedRef.current) return;

    if (result.status === "ok") {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      retryAttemptRef.current = 0;
      revisionRef.current = result.revision;
      centralConfiguredRef.current = true;
      if (generation === generationRef.current) {
        dirtyRef.current = false;
        saveHrState(stateRef.current, { revision: result.revision, dirty: false });
        setSyncStatus("centraal");
      } else {
        saveHrState(stateRef.current, {
          revision: result.revision,
          dirty: true,
          operationId: pendingOperationRef.current ?? undefined,
          audit: pendingAuditRef.current ?? undefined,
        });
        schedulePushRef.current();
      }
      return;
    }

    if (result.status === "conflict") {
      pendingOperationRef.current ??= operationId;
      pendingAuditRef.current = mergeAudit(audit, pendingAuditRef.current ?? { source: "manual" });
      conflictRef.current = { state: result.state, revision: result.revision };
      setConflictState(conflictRef.current);
      setSyncStatus("conflict");
    } else {
      pendingOperationRef.current ??= operationId;
      pendingAuditRef.current = mergeAudit(audit, pendingAuditRef.current ?? { source: "manual" });
      setSyncStatus(result.status === "unconfigured" ? "lokaal" : "fout");
      if (result.status === "failed") scheduleRetryRef.current();
    }

    saveHrState(stateRef.current, {
      revision: revisionRef.current,
      dirty: true,
      operationId: pendingOperationRef.current,
      audit: pendingAuditRef.current,
    });
  }, []);

  const schedulePush = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void flushPending(), PUSH_DEBOUNCE_MS);
  }, [flushPending]);
  schedulePushRef.current = schedulePush;

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current || conflictRef.current || !dirtyRef.current) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttemptRef.current);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      retryAttemptRef.current += 1;
      void flushPending();
    }, delay);
  }, [flushPending]);
  scheduleRetryRef.current = scheduleRetry;

  const persist = useCallback(
    (next: HrState, audit: HrChangeAudit = { source: "manual" }) => {
      setStored(next);
      dirtyRef.current = true;
      generationRef.current += 1;
      pendingOperationRef.current ??= crypto.randomUUID();
      pendingAuditRef.current = mergeAudit(pendingAuditRef.current, audit);
      saveHrState(next, {
        revision: revisionRef.current,
        dirty: true,
        operationId: pendingOperationRef.current,
        audit: pendingAuditRef.current,
      });
      if (!conflictRef.current) schedulePush();
    },
    [schedulePush],
  );

  useEffect(() => {
    mountedRef.current = true;
    const local = loadHrCache();
    if (local) {
      setStored(local.state);
      revisionRef.current = local.revision;
      dirtyRef.current = local.dirty;
      pendingOperationRef.current = local.operationId ?? null;
      pendingAuditRef.current = local.audit ?? null;
    }
    setHydrated(true);

    let cancelled = false;
    void fetchRemoteHrState().then((remote) => {
      if (cancelled) return;
      if (remote.status === "unconfigured") {
        setSyncStatus("lokaal");
        return;
      }
      if (remote.status === "failed") {
        setSyncStatus("fout");
        return;
      }

      centralConfiguredRef.current = true;
      if (local?.dirty) {
        if (local.revision === remote.revision) {
          setSyncStatus("centraal");
          schedulePushRef.current();
        } else {
          conflictRef.current = { state: remote.state, revision: remote.revision };
          setConflictState(conflictRef.current);
          setSyncStatus("conflict");
        }
        return;
      }

      revisionRef.current = remote.revision;
      if (remote.state) {
        stateRef.current = remote.state;
        setStored(remote.state);
        saveHrState(remote.state, { revision: remote.revision, dirty: false });
      }
      setSyncStatus("centraal");
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (dirtyRef.current || pushingRef.current || conflictRef.current || !centralConfiguredRef.current) return;
      void fetchRemoteHrState().then((remote) => {
        if (remote.status !== "ok" || remote.revision <= revisionRef.current || !remote.state || !mountedRef.current) {
          return;
        }
        revisionRef.current = remote.revision;
        stateRef.current = remote.state;
        setStored(remote.state);
        saveHrState(remote.state, { revision: remote.revision, dirty: false });
        setSyncStatus("centraal");
      });
    }, PULL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const retrySync = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    retryAttemptRef.current = 0;
    setSyncStatus("laden");
    if (dirtyRef.current) {
      void flushPending();
      return;
    }
    void fetchRemoteHrState().then((remote) => {
      if (!mountedRef.current) return;
      if (remote.status === "unconfigured") {
        setSyncStatus("lokaal");
        return;
      }
      if (remote.status === "failed") {
        setSyncStatus("fout");
        return;
      }
      centralConfiguredRef.current = true;
      revisionRef.current = remote.revision;
      if (remote.state) {
        stateRef.current = remote.state;
        setStored(remote.state);
        saveHrState(remote.state, { revision: remote.revision, dirty: false });
      }
      setSyncStatus("centraal");
    });
  }, [flushPending]);

  const mutate = useCallback(
    (fn: (draft: HrState) => HrState, audit?: HrChangeAudit) => {
      const next = { ...fn(stateRef.current), updatedAt: new Date().toISOString() };
      stateRef.current = next;
      persist(next, audit);
    },
    [persist],
  );

  const resolveConflict = useCallback(
    (keuze: "centraal" | "lokaal") => {
      const conflict = conflictRef.current;
      if (!conflict) return;
      if (keuze === "centraal") {
        if (!conflict.state) return;
        revisionRef.current = conflict.revision;
        dirtyRef.current = false;
        pendingOperationRef.current = null;
        pendingAuditRef.current = null;
        stateRef.current = conflict.state;
        setStored(conflict.state);
        saveHrState(conflict.state, { revision: conflict.revision, dirty: false });
      } else {
        revisionRef.current = conflict.revision;
        dirtyRef.current = true;
        generationRef.current += 1;
        pendingOperationRef.current = crypto.randomUUID();
        pendingAuditRef.current = { source: "manual" };
        saveHrState(stateRef.current, {
          revision: conflict.revision,
          dirty: true,
          operationId: pendingOperationRef.current,
          audit: pendingAuditRef.current,
        });
      }
      conflictRef.current = null;
      setConflictState(null);
      setSyncStatus("centraal");
      if (keuze === "lokaal") schedulePush();
    },
    [schedulePush],
  );

  const setKpi = useCallback(
    (id: HrKpiId, veld: "value" | "prev", waarde: number) => {
      mutate((draft) => ({
        ...draft,
        kpis: { ...draft.kpis, [id]: { ...draft.kpis[id], [veld]: normalizeHrKpiValue(id, waarde) } },
      }));
    },
    [mutate],
  );

  const setTrendPunt = useCallback(
    (index: number, waarde: number) => {
      mutate((draft) => ({
        ...draft,
        verzuimTrend: draft.verzuimTrend.map((punt, i) => (i === index ? clamp(waarde, HR_LIMITS.percentage) : punt)),
      }));
    },
    [mutate],
  );

  const setBenchmark = useCallback(
    (waarde: number) => {
      mutate((draft) => ({ ...draft, benchmark: clamp(waarde, HR_LIMITS.percentage) }));
    },
    [mutate],
  );

  // Vereiste velden nooit ongeldig laten worden: lege naam of ongeldige datum
  // wordt genegeerd (de invoer valt terug op de opgeslagen waarde).
  const setBigVeld = useCallback(
    (index: number, veld: "naam" | "functie" | "verloopt", waarde: string) => {
      const schoon = waarde.trim();
      if (veld === "naam" && (schoon === "" || schoon.length > HR_LIMITS.naam)) return;
      if (veld === "functie" && schoon.length > HR_LIMITS.functie) return;
      if (veld === "verloopt" && !isHrIsoDate(schoon)) return;
      const huidig = stateRef.current.bigRegistraties[index];
      if (!huidig) return;
      const volgendeNaam = veld === "naam" ? schoon : huidig.naam;
      const volgendeDatum = veld === "verloopt" ? schoon : huidig.verloopt;
      if (
        stateRef.current.bigRegistraties.some(
          (rij, i) =>
            i !== index &&
            rij.naam.localeCompare(volgendeNaam, "nl", { sensitivity: "base" }) === 0 &&
            rij.verloopt === volgendeDatum,
        )
      ) {
        return;
      }
      mutate((draft) => ({
        ...draft,
        bigRegistraties: draft.bigRegistraties.map((rij, i) => (i === index ? { ...rij, [veld]: schoon } : rij)),
      }));
    },
    [mutate],
  );

  const addBig = useCallback(
    (naam: string, functie: string, verloopt: string): boolean => {
      const naamSchoon = naam.trim();
      const verlooptSchoon = verloopt.trim();
      if (
        naamSchoon === "" ||
        naamSchoon.length > HR_LIMITS.naam ||
        !isHrIsoDate(verlooptSchoon) ||
        stateRef.current.bigRegistraties.some(
          (rij) =>
            rij.naam.localeCompare(naamSchoon, "nl", { sensitivity: "base" }) === 0 && rij.verloopt === verlooptSchoon,
        ) ||
        stateRef.current.bigRegistraties.length >= HR_LIMITS.big
      ) {
        return false;
      }
      mutate((draft) => ({
        ...draft,
        bigRegistraties: [
          ...draft.bigRegistraties,
          { naam: naamSchoon, functie: functie.trim().slice(0, HR_LIMITS.functie), verloopt: verlooptSchoon },
        ],
      }));
      return true;
    },
    [mutate],
  );

  const removeBig = useCallback(
    (index: number) => {
      mutate((draft) => ({ ...draft, bigRegistraties: draft.bigRegistraties.filter((_, i) => i !== index) }));
    },
    [mutate],
  );

  const value = useMemo(
    () => ({
      state,
      syncStatus: hydrated ? syncStatus : ("laden" as const),
      retrySync,
      resolveConflict,
      hasCentralConflictVersion: Boolean(conflictState?.state),
      setKpi,
      setTrendPunt,
      setBenchmark,
      setBigVeld,
      addBig,
      removeBig,
    }),
    [
      state,
      hydrated,
      syncStatus,
      retrySync,
      resolveConflict,
      conflictState,
      setKpi,
      setTrendPunt,
      setBenchmark,
      setBigVeld,
      addBig,
      removeBig,
    ],
  );

  return <CareonHrContext.Provider value={value}>{children}</CareonHrContext.Provider>;
}
