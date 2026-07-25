"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { DEMO_MIDDELEN_STATE, EMPTY_MIDDELEN_STATE, TEAM_SEED } from "@/data/careon/careon-middelen";
import { fetchRemoteMiddelenState, pushRemoteMiddelenState } from "@/lib/careon-middelen/remote.client";
import { loadMiddelenCache, saveMiddelenState } from "@/lib/careon-middelen/storage.client";
import type {
  LocatieInventaris,
  MedewerkerMiddelen,
  MiddelenChangeAudit,
  MiddelenState,
  MiddelType,
} from "@/lib/careon-middelen/types";

import { useCareon } from "./careon-provider";

// Handmatig bijgehouden middelen & inventaris (handoff 09). De registratie is
// één administratie los van de databron: opgeslagen staat wint altijd; zonder
// opgeslagen staat toont demo-modus de voorbeeldseed en start productie leeg.
// Elke wijziging gaat direct naar localStorage en met een korte debounce naar
// de centrale Supabase-opslag (of blijft lokaal wanneer die niet is
// geconfigureerd — de route antwoordt dan 501).

export type MiddelenSyncStatus = "laden" | "centraal" | "lokaal" | "fout" | "conflict";

type InventarisVeld = "behandelkamers" | "boeken" | "diagnostiek" | "laptops";

interface CareonMiddelenContextValue {
  state: MiddelenState;
  syncStatus: MiddelenSyncStatus;
  /** Uitgegeven middelen per medewerkersnaam (voor de badges op Behandelaren). */
  middelenByNaam: Map<string, MiddelType[]>;
  /** Volledige registratierij per naam (functie/talen op Behandelaren). */
  registratieByNaam: Map<string, MedewerkerMiddelen>;
  /** Actuele staat, ook direct na een mutatie in dezelfde taak (vóór re-render) —
      voor de assistent-executor die meerdere acties in één beurt uitvoert. */
  getState: () => MiddelenState;
  /** Vervang de volledige staat in één keer — het toepassen van een door de
      gebruiker goedgekeurd assistent-concept (handoff 11). */
  vervangState: (volgende: MiddelenState, audit?: MiddelenChangeAudit) => void;
  resolveConflict: (keuze: "centraal" | "lokaal") => void;
  hasCentralConflictVersion: boolean;
  toggleMiddel: (naam: string, middel: MiddelType) => void;
  /** Idempotente variant van toggleMiddel (assistent-acties): expliciet aan/uit. */
  setMiddel: (naam: string, middel: MiddelType, aanwezig: boolean) => void;
  setTaal: (naam: string, taal: string, aanwezig: boolean) => void;
  setTeamTag: (naam: string, team: string, aanwezig: boolean) => void;
  /** Uit dienst: registratie blijft bewaard; weer in dienst wist de markering. */
  setUitDienst: (naam: string, uitDienst: boolean) => void;
  setFunctie: (naam: string, functie: string) => void;
  toggleTaal: (naam: string, taal: string) => void;
  toggleTeamTag: (naam: string, team: string) => void;
  addTeam: (locatie: string, naam: string) => boolean;
  removeTeam: (locatie: string, naam: string) => void;
  setNotitie: (naam: string, notitie: string) => void;
  addPersoon: (naam: string) => boolean;
  removePersoon: (naam: string) => void;
  setInventarisVeld: (locatie: string, veld: InventarisVeld, aantal: number) => void;
  addLocatie: (locatie: string) => boolean;
  removeLocatie: (locatie: string) => void;
}

const CareonMiddelenContext = createContext<CareonMiddelenContextValue | null>(null);

export function useCareonMiddelen(): CareonMiddelenContextValue {
  const ctx = useContext(CareonMiddelenContext);
  if (!ctx) {
    throw new Error("useCareonMiddelen must be used within a CareonMiddelenProvider");
  }
  return ctx;
}

const PUSH_DEBOUNCE_MS = 800;
const PULL_INTERVAL_MS = 15_000;

function mergeAudit(huidig: MiddelenChangeAudit | null, volgend: MiddelenChangeAudit): MiddelenChangeAudit {
  if (!huidig) return volgend;
  return {
    source: huidig.source === "assistant" || volgend.source === "assistant" ? "assistant" : "manual",
    toolNames: [...new Set([...(huidig.toolNames ?? []), ...(volgend.toolNames ?? [])])],
    requestIds: [...new Set([...(huidig.requestIds ?? []), ...(volgend.requestIds ?? [])])],
  };
}

export function CareonMiddelenProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { isProduction } = useCareon();
  const [stored, setStored] = useState<MiddelenState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<MiddelenSyncStatus>("laden");
  const [conflictState, setConflictState] = useState<{ state: MiddelenState | null; revision: number } | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const generationRef = useRef(0);
  const pendingOperationRef = useRef<string | null>(null);
  const pendingAuditRef = useRef<MiddelenChangeAudit | null>(null);
  const pushingRef = useRef(false);
  const conflictRef = useRef<typeof conflictState>(null);
  const centralConfiguredRef = useRef(false);
  const mountedRef = useRef(true);

  const state = useMemo(() => {
    const basis = stored ?? (isProduction ? EMPTY_MIDDELEN_STATE : DEMO_MIDDELEN_STATE);
    return basis.teams === undefined ? { ...basis, teams: TEAM_SEED } : basis;
  }, [stored, isProduction]);

  // Synchrone spiegel: opeenvolgende assistentacties lezen altijd de laatst
  // berekende staat, ook voordat React opnieuw heeft gerenderd.
  const stateRef = useRef(state);
  stateRef.current = state;
  const schedulePushRef = useRef<() => void>(() => undefined);

  const flushPending = useCallback(async () => {
    if (pushingRef.current || conflictRef.current || !dirtyRef.current) return;
    pushingRef.current = true;
    const snapshot = stateRef.current;
    const generation = generationRef.current;
    const operationId = pendingOperationRef.current ?? crypto.randomUUID();
    const audit = pendingAuditRef.current ?? { source: "manual" as const };
    pendingOperationRef.current = null;
    pendingAuditRef.current = null;

    const result = await pushRemoteMiddelenState(snapshot, {
      baseRevision: revisionRef.current,
      operationId,
      audit,
    });
    pushingRef.current = false;
    if (!mountedRef.current) return;

    if (result.status === "ok") {
      revisionRef.current = result.revision;
      centralConfiguredRef.current = true;
      if (generation === generationRef.current) {
        dirtyRef.current = false;
        saveMiddelenState(stateRef.current, { revision: result.revision, dirty: false });
        setSyncStatus("centraal");
      } else {
        saveMiddelenState(stateRef.current, {
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
    }

    saveMiddelenState(stateRef.current, {
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

  const persist = useCallback(
    (next: MiddelenState, audit: MiddelenChangeAudit = { source: "manual" }) => {
      setStored(next);
      dirtyRef.current = true;
      generationRef.current += 1;
      pendingOperationRef.current ??= crypto.randomUUID();
      pendingAuditRef.current = mergeAudit(pendingAuditRef.current, audit);
      saveMiddelenState(next, {
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
    const local = loadMiddelenCache();
    if (local) {
      setStored(local.state);
      revisionRef.current = local.revision;
      dirtyRef.current = local.dirty;
      pendingOperationRef.current = local.operationId ?? null;
      pendingAuditRef.current = local.audit ?? null;
    }
    setHydrated(true);

    let cancelled = false;
    void fetchRemoteMiddelenState().then((remote) => {
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
        saveMiddelenState(remote.state, { revision: remote.revision, dirty: false });
      } else if (local) {
        dirtyRef.current = true;
        pendingOperationRef.current = crypto.randomUUID();
        pendingAuditRef.current = { source: "manual" };
        saveMiddelenState(local.state, {
          revision: remote.revision,
          dirty: true,
          operationId: pendingOperationRef.current,
          audit: pendingAuditRef.current,
        });
        schedulePushRef.current();
      }
      setSyncStatus("centraal");
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (dirtyRef.current || pushingRef.current || conflictRef.current || !centralConfiguredRef.current) return;
      void fetchRemoteMiddelenState().then((remote) => {
        if (remote.status !== "ok" || remote.revision <= revisionRef.current || !remote.state || !mountedRef.current) {
          return;
        }
        revisionRef.current = remote.revision;
        stateRef.current = remote.state;
        setStored(remote.state);
        saveMiddelenState(remote.state, { revision: remote.revision, dirty: false });
        setSyncStatus("centraal");
      });
    }, PULL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const mutate = useCallback(
    (fn: (draft: MiddelenState) => MiddelenState, audit?: MiddelenChangeAudit) => {
      const next = { ...fn(stateRef.current), updatedAt: new Date().toISOString() };
      stateRef.current = next;
      persist(next, audit);
    },
    [persist],
  );

  const getState = useCallback(() => stateRef.current, []);

  const vervangState = useCallback(
    (volgende: MiddelenState, audit?: MiddelenChangeAudit) => {
      mutate(() => volgende, audit);
    },
    [mutate],
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
        saveMiddelenState(conflict.state, { revision: conflict.revision, dirty: false });
      } else {
        revisionRef.current = conflict.revision;
        dirtyRef.current = true;
        generationRef.current += 1;
        pendingOperationRef.current = crypto.randomUUID();
        pendingAuditRef.current = { source: "manual" };
        saveMiddelenState(stateRef.current, {
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

  // Upsert-patroon voor alle per-medewerker-velden: bestaat de rij nog niet
  // (bijv. een EPD-medewerker zonder registratie), dan wordt hij aangemaakt.
  const patchMedewerker = useCallback(
    (naam: string, patch: (rij: MedewerkerMiddelen) => MedewerkerMiddelen) => {
      mutate((draft) => {
        const bestaand = draft.medewerkers.find((row) => row.naam === naam);
        if (!bestaand) {
          return { ...draft, medewerkers: [...draft.medewerkers, patch({ naam, middelen: [] })] };
        }
        return { ...draft, medewerkers: draft.medewerkers.map((row) => (row.naam === naam ? patch(row) : row)) };
      });
    },
    [mutate],
  );

  const toggleMiddel = useCallback(
    (naam: string, middel: MiddelType) => {
      patchMedewerker(naam, (rij) => ({
        ...rij,
        middelen: rij.middelen.includes(middel)
          ? rij.middelen.filter((eigen) => eigen !== middel)
          : [...rij.middelen, middel],
      }));
    },
    [patchMedewerker],
  );

  const setMiddel = useCallback(
    (naam: string, middel: MiddelType, aanwezig: boolean) => {
      patchMedewerker(naam, (rij) => {
        if (aanwezig === rij.middelen.includes(middel)) return rij;
        return {
          ...rij,
          middelen: aanwezig ? [...rij.middelen, middel] : rij.middelen.filter((eigen) => eigen !== middel),
        };
      });
    },
    [patchMedewerker],
  );

  const setFunctie = useCallback(
    (naam: string, functie: string) => {
      patchMedewerker(naam, (rij) => ({ ...rij, functie: functie === "" ? undefined : functie }));
    },
    [patchMedewerker],
  );

  const setUitDienst = useCallback(
    (naam: string, uitDienst: boolean) => {
      patchMedewerker(naam, (rij) => ({ ...rij, uitDienst: uitDienst ? true : undefined }));
    },
    [patchMedewerker],
  );

  const setTaal = useCallback(
    (naam: string, taal: string, aanwezig: boolean) => {
      patchMedewerker(naam, (rij) => {
        const huidig = rij.talen ?? [];
        if (aanwezig === huidig.includes(taal)) return rij;
        const talen = aanwezig ? [...huidig, taal] : huidig.filter((eigen) => eigen !== taal);
        return { ...rij, talen: talen.length === 0 ? undefined : talen };
      });
    },
    [patchMedewerker],
  );

  const setTeamTag = useCallback(
    (naam: string, team: string, aanwezig: boolean) => {
      patchMedewerker(naam, (rij) => {
        const huidig = rij.teams ?? [];
        if (aanwezig === huidig.includes(team)) return rij;
        const teams = aanwezig ? [...huidig, team] : huidig.filter((eigen) => eigen !== team);
        return { ...rij, teams: teams.length === 0 ? undefined : teams };
      });
    },
    [patchMedewerker],
  );

  const toggleTaal = useCallback(
    (naam: string, taal: string) => {
      patchMedewerker(naam, (rij) => {
        const huidig = rij.talen ?? [];
        const talen = huidig.includes(taal) ? huidig.filter((eigen) => eigen !== taal) : [...huidig, taal];
        return { ...rij, talen: talen.length === 0 ? undefined : talen };
      });
    },
    [patchMedewerker],
  );

  const toggleTeamTag = useCallback(
    (naam: string, team: string) => {
      patchMedewerker(naam, (rij) => {
        const huidig = rij.teams ?? [];
        const teams = huidig.includes(team) ? huidig.filter((eigen) => eigen !== team) : [...huidig, team];
        return { ...rij, teams: teams.length === 0 ? undefined : teams };
      });
    },
    [patchMedewerker],
  );

  const addTeam = useCallback(
    (locatie: string, naam: string): boolean => {
      const schoon = naam.trim();
      const bestaand = stateRef.current.teams ?? [];
      if (
        !schoon ||
        bestaand.some((team) => team.locatie === locatie && team.naam.toLowerCase() === schoon.toLowerCase())
      ) {
        return false;
      }
      mutate((draft) => ({ ...draft, teams: [...(draft.teams ?? []), { naam: schoon, locatie }] }));
      return true;
    },
    [mutate],
  );

  // Verwijdert alleen de structuurrij; bestaande teamtags op medewerkers
  // blijven staan (nooit stil gegevens weggooien) en zijn per medewerker
  // uit te zetten — de tagkiezer blijft ze tonen als "niet in structuur".
  const removeTeam = useCallback(
    (locatie: string, naam: string) => {
      mutate((draft) => ({
        ...draft,
        teams: (draft.teams ?? []).filter((team) => !(team.locatie === locatie && team.naam === naam)),
      }));
    },
    [mutate],
  );

  const setNotitie = useCallback(
    (naam: string, notitie: string) => {
      mutate((draft) => {
        const bestaand = draft.medewerkers.find((row) => row.naam === naam);
        const genormaliseerd = notitie.trim() === "" ? undefined : notitie;
        if (!bestaand) {
          if (genormaliseerd === undefined) return draft;
          return { ...draft, medewerkers: [...draft.medewerkers, { naam, middelen: [], notitie: genormaliseerd }] };
        }
        return {
          ...draft,
          medewerkers: draft.medewerkers.map((row) => (row.naam === naam ? { ...row, notitie: genormaliseerd } : row)),
        };
      });
    },
    [mutate],
  );

  const addPersoon = useCallback(
    (naam: string): boolean => {
      const schoon = naam.trim();
      if (!schoon || stateRef.current.medewerkers.some((row) => row.naam.toLowerCase() === schoon.toLowerCase())) {
        return false;
      }
      mutate((draft) => ({
        ...draft,
        medewerkers: [...draft.medewerkers, { naam: schoon, handmatig: true, middelen: [] }],
      }));
      return true;
    },
    [mutate],
  );

  const removePersoon = useCallback(
    (naam: string) => {
      mutate((draft) => ({ ...draft, medewerkers: draft.medewerkers.filter((row) => row.naam !== naam) }));
    },
    [mutate],
  );

  const setInventarisVeld = useCallback(
    (locatie: string, veld: InventarisVeld, aantal: number) => {
      const veilig = Number.isFinite(aantal) ? Math.max(0, Math.round(aantal)) : 0;
      mutate((draft) => {
        const bestaand = draft.inventaris.find((row) => row.locatie === locatie);
        if (!bestaand) {
          const nieuw: LocatieInventaris = { locatie, behandelkamers: 0, boeken: 0, diagnostiek: 0, [veld]: veilig };
          return { ...draft, inventaris: [...draft.inventaris, nieuw] };
        }
        return {
          ...draft,
          inventaris: draft.inventaris.map((row) => (row.locatie === locatie ? { ...row, [veld]: veilig } : row)),
        };
      });
    },
    [mutate],
  );

  const addLocatie = useCallback(
    (locatie: string): boolean => {
      const schoon = locatie.trim();
      if (!schoon || stateRef.current.inventaris.some((row) => row.locatie.toLowerCase() === schoon.toLowerCase())) {
        return false;
      }
      mutate((draft) => ({
        ...draft,
        inventaris: [
          ...draft.inventaris,
          { locatie: schoon, handmatig: true, behandelkamers: 0, boeken: 0, diagnostiek: 0 },
        ],
      }));
      return true;
    },
    [mutate],
  );

  const removeLocatie = useCallback(
    (locatie: string) => {
      mutate((draft) => ({ ...draft, inventaris: draft.inventaris.filter((row) => row.locatie !== locatie) }));
    },
    [mutate],
  );

  const middelenByNaam = useMemo(() => {
    const map = new Map<string, MiddelType[]>();
    for (const row of state.medewerkers) {
      if (row.middelen.length > 0) {
        map.set(row.naam, row.middelen);
      }
    }
    return map;
  }, [state]);

  const registratieByNaam = useMemo(() => new Map(state.medewerkers.map((row) => [row.naam, row])), [state]);

  const value = useMemo(
    () => ({
      state,
      // Vóór hydratatie geen misleidende "lokaal"-melding.
      syncStatus: hydrated ? syncStatus : ("laden" as const),
      middelenByNaam,
      registratieByNaam,
      getState,
      vervangState,
      resolveConflict,
      hasCentralConflictVersion: Boolean(conflictState?.state),
      toggleMiddel,
      setMiddel,
      setTaal,
      setTeamTag,
      setUitDienst,
      setFunctie,
      toggleTaal,
      toggleTeamTag,
      addTeam,
      removeTeam,
      setNotitie,
      addPersoon,
      removePersoon,
      setInventarisVeld,
      addLocatie,
      removeLocatie,
    }),
    [
      state,
      hydrated,
      syncStatus,
      middelenByNaam,
      registratieByNaam,
      getState,
      vervangState,
      resolveConflict,
      conflictState,
      toggleMiddel,
      setMiddel,
      setTaal,
      setTeamTag,
      setUitDienst,
      setFunctie,
      toggleTaal,
      toggleTeamTag,
      addTeam,
      removeTeam,
      setNotitie,
      addPersoon,
      removePersoon,
      setInventarisVeld,
      addLocatie,
      removeLocatie,
    ],
  );

  return <CareonMiddelenContext.Provider value={value}>{children}</CareonMiddelenContext.Provider>;
}
