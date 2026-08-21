"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { RefreshCw, Search, ShieldAlert, UserCheck, UserRoundPlus, Users, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CareonStatus = "not_started" | "identity_only" | "active" | "blocked";

interface EntraMemberRow {
  entraObjectId: string;
  displayName: string;
  email: string;
  userPrincipalName: string;
  jobTitle: string;
  userType: "Member" | "Guest" | "Unknown";
  accountEnabled: boolean | null;
  licensed: boolean | null;
  eligible: boolean;
  matchEmail: string;
  careonStatus: CareonStatus;
  careonUserId: string | null;
  careonName: string;
  careonRole: "org_admin" | "member" | null;
  careonLastSignIn: string | null;
  isSelf: boolean;
  yaazStatus: "not_started" | "active" | "blocked" | "unknown";
  yaazLastLogin: string | null;
  microsoft365Status: "connected" | "not_connected" | "unknown";
  microsoft365UpdatedAt: string | null;
}

interface EntraPayload {
  configured: true;
  eligibilitySource: "app_role_assignments" | "group";
  yaazAvailable: boolean;
  members: EntraMemberRow[];
  summary: {
    directoryTotal: number;
    eligible: number;
    active: number;
    pendingFirstLogin: number;
    blocked: number;
    guests: number;
    disabled: number;
    unlicensed: number;
  };
}

const STATUS_LABEL: Record<CareonStatus, string> = {
  active: "Actief in Careon",
  blocked: "Geblokkeerd",
  identity_only: "Microsoft-login herhalen",
  not_started: "Eerste login open",
};

function statusVariant(status: CareonStatus): "default" | "destructive" | "outline" | "secondary" {
  if (status === "active") return "default";
  if (status === "blocked") return "destructive";
  return status === "identity_only" ? "secondary" : "outline";
}

function formatMoment(iso: string | null): string {
  if (!iso) return "Nog niet ingelogd";
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function careonRoleLabel(role: EntraMemberRow["careonRole"]): string {
  if (role === "org_admin") return "Organisatiebeheerder";
  if (role === "member") return "Gebruiker";
  return "Nog niet toegekend";
}

function yaazStatusLabel(status: EntraMemberRow["yaazStatus"]): string {
  if (status === "active") return "Actief";
  if (status === "blocked") return "Geblokkeerd";
  if (status === "not_started") return "Nog niet geopend";
  return "Onbekend";
}

function yaazStatusVariant(status: EntraMemberRow["yaazStatus"]): "default" | "destructive" | "outline" | "secondary" {
  if (status === "active") return "default";
  if (status === "blocked") return "destructive";
  return status === "not_started" ? "outline" : "secondary";
}

function microsoftStatusLabel(status: EntraMemberRow["microsoft365Status"]): string {
  if (status === "connected") return "Gekoppeld";
  if (status === "not_connected") return "Niet gekoppeld";
  return "Onbekend";
}

export function EntraMembersPanel() {
  const [payload, setPayload] = useState<EntraPayload | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/org/entra-members", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as
        | EntraPayload
        | { configured?: boolean; error?: string; reason?: string }
        | null;
      if (response.ok && body?.configured === false) {
        setConfigured(false);
        setPayload(null);
        return;
      }
      if (!response.ok || !body || body.configured !== true || !("members" in body)) {
        setConfigured(body?.configured ?? null);
        setError(
          body && "error" in body && body.error ? body.error : "Microsoft-medewerkers konden niet worden opgehaald.",
        );
        return;
      }
      setConfigured(true);
      setPayload(body);
    } catch {
      setError("Microsoft-medewerkers konden niet worden opgehaald.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleMembers = useMemo(() => {
    if (!payload) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return payload.members;
    return payload.members.filter((member) =>
      [
        member.displayName,
        member.matchEmail,
        member.jobTitle,
        STATUS_LABEL[member.careonStatus],
        member.eligible ? "Careon.User toegang" : "geen Careon toegang",
        member.userType,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [payload, query]);

  if (loading && !payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Microsoft-medewerkers</CardTitle>
          <CardDescription>De volledige Entra-directory en Careon-accounts worden vergeleken.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">Medewerkers laden…</CardContent>
      </Card>
    );
  }

  if (configured === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Microsoft-medewerkers</CardTitle>
          <CardDescription>De Directie-koppeling is voorbereid maar nog niet geactiveerd.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-start gap-3 text-muted-foreground text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          Totdat TGC-IT de aparte leesconnector en eligibility-bron activeert, blijft het bestaande Careon-overzicht
          hieronder beschikbaar.
        </CardContent>
      </Card>
    );
  }

  if (error || !payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Microsoft-medewerkers</CardTitle>
          <CardDescription>
            De Careon-accounts blijven beschikbaar; alleen de Entra-vergelijking is verstoord.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="flex items-start gap-3 text-muted-foreground text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" />
            Opnieuw
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summaryCards = [
    { label: "Microsoft-identiteiten", value: payload.summary.directoryTotal, icon: Users },
    { label: "Toegelaten in Entra", value: payload.summary.eligible, icon: UsersRound },
    { label: "Actief in Careon", value: payload.summary.active, icon: UserCheck },
    { label: "Eerste login open", value: payload.summary.pendingFirstLogin, icon: UserRoundPlus },
  ];

  return (
    <section aria-labelledby="entra-members-title" className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-center justify-between py-5">
              <div>
                <p className="text-muted-foreground text-xs">{item.label}</p>
                <p className="mt-1 font-semibold text-2xl tabular-nums">{item.value}</p>
              </div>
              <item.icon className="size-5 text-primary" aria-hidden="true" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle id="entra-members-title">Microsoft-medewerkers</CardTitle>
            <CardDescription className="mt-1 max-w-3xl">
              Alle Microsoft-identiteiten staan in dit overzicht. Alleen een actieve tenantmedewerker met Careon.User
              mag inloggen; diens eerste Microsoft-login kan uitsluitend de standaardrol Gebruiker aanmaken.
              Toegangsbron:{" "}
              {payload.eligibilitySource === "app_role_assignments"
                ? "directe Careon.User-toewijzingen"
                : "goedgekeurde Entra-groep"}
              .
            </CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            Vernieuwen
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <label htmlFor="entra-member-search" className="relative block max-w-md">
            <span className="sr-only">Zoek Microsoft-medewerker</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="entra-member-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Zoek op naam, e-mail, functie of status"
              className="pl-8"
            />
          </label>

          {visibleMembers.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">Geen medewerkers gevonden.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1360px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Microsoft-medewerker</TableHead>
                    <TableHead>Functie</TableHead>
                    <TableHead>Microsoft-account</TableHead>
                    <TableHead>Careon-toegang</TableHead>
                    <TableHead>Careon-status</TableHead>
                    <TableHead>Careon-rol</TableHead>
                    <TableHead>Laatste Careon-login</TableHead>
                    <TableHead>YAAZ</TableHead>
                    <TableHead>Microsoft 365</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMembers.map((member) => (
                    <TableRow key={member.entraObjectId}>
                      <TableCell>
                        <p className="font-medium">
                          {member.displayName || member.careonName || member.matchEmail}
                          {member.isSelf && <span className="ml-2 text-muted-foreground text-xs">(uzelf)</span>}
                        </p>
                        <p className="text-muted-foreground text-xs">{member.matchEmail || "Geen e-mailadres"}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{member.jobTitle || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={member.accountEnabled === false ? "destructive" : "outline"}>
                            {member.accountEnabled === false ? "Uitgeschakeld" : "Actief"}
                          </Badge>
                          {member.userType !== "Member" && <Badge variant="destructive">{member.userType}</Badge>}
                          {member.licensed === false && <Badge variant="secondary">Geen licentie</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.eligible ? "default" : "outline"}>
                          {member.eligible ? "Careon.User" : "Niet toegelaten"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(member.careonStatus)}>{STATUS_LABEL[member.careonStatus]}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{careonRoleLabel(member.careonRole)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatMoment(member.careonLastSignIn)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={yaazStatusVariant(member.yaazStatus)}>
                          {yaazStatusLabel(member.yaazStatus)}
                        </Badge>
                        {member.yaazStatus === "active" && (
                          <p className="mt-1 text-muted-foreground text-xs">{formatMoment(member.yaazLastLogin)}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.microsoft365Status === "connected" ? "default" : "outline"}>
                          {microsoftStatusLabel(member.microsoft365Status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {(payload.summary.blocked > 0 || payload.summary.guests > 0 || payload.summary.disabled > 0) && (
            <p className="text-muted-foreground text-xs">
              Controle nodig: {payload.summary.blocked} Careon-account(s) geblokkeerd · {payload.summary.guests}{" "}
              gastaccount(s) · {payload.summary.disabled} Microsoft-account(s) uitgeschakeld. Gasten en uitgeschakelde
              accounts krijgen nooit automatisch Careon-toegang.
            </p>
          )}
          {!payload.yaazAvailable && (
            <p className="text-muted-foreground text-xs">
              De YAAZ-statuskoppeling is nog niet actief of tijdelijk niet bereikbaar; Careon- en Entra-status blijven
              hierboven wel actueel.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
