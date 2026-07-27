"use client";

import { useCallback, useEffect, useState } from "react";

import { ShieldAlert } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { MemberActions } from "./member-actions";
import { MemberCreateForm } from "./member-create-form";

// Organisatiebeheer (handoff 13, fase 6): een org_admin beheert de accounts
// van de eigen organisatie. Autorisatie ligt bij /api/org/members — deze
// pagina toont alleen wat die route teruggeeft (403 → nette uitleg).

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: "org_admin" | "member";
  lastSignIn: string | null;
  banned: boolean;
  isPlatformAdmin: boolean;
  isSelf: boolean;
}

const ROL_LABELS = { org_admin: "Organisatiebeheerder", member: "Gebruiker" } as const;

function formatMoment(iso: string | null): string {
  if (!iso) return "nog niet ingelogd";
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function BeheerContent() {
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const laadLeden = useCallback(async () => {
    try {
      const response = await fetch("/api/org/members", { cache: "no-store" });
      if (response.status === 501) {
        setBlocked("Gebruikersbeheer is niet beschikbaar in de demo-omgeving — accounts bestaan alleen in productie.");
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setBlocked("Deze pagina is alleen beschikbaar voor organisatiebeheerders.");
        return;
      }
      if (!response.ok) {
        setBlocked("De ledenlijst kon niet worden opgehaald — probeer het later opnieuw.");
        return;
      }
      const payload = (await response.json()) as { members: OrgMember[] };
      setBlocked(null);
      setMembers(payload.members);
    } catch {
      setBlocked("De ledenlijst kon niet worden opgehaald — probeer het later opnieuw.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void laadLeden();
  }, [laadLeden]);

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title="Gebruikersbeheer"
        sub="Accounts van uw organisatie aanmaken en beheren — nieuwe collega's kiezen zelf een wachtwoord via de link die u persoonlijk doorgeeft."
      />

      {blocked && (
        <Card>
          <CardContent className="flex items-start gap-3 py-6 text-muted-foreground text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {blocked}
          </CardContent>
        </Card>
      )}

      {!blocked && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Leden van uw organisatie</CardTitle>
              <CardDescription>
                "Wachtwoord-link" maakt een nieuwe link waarmee het lid zelf een (nieuw) wachtwoord kiest; blokkeren
                geldt direct en houdt aan tot u deblokkeert.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading && <p className="text-muted-foreground text-sm">Ledenlijst laden…</p>}
              {!loading && members && members.length === 0 && (
                <p className="text-muted-foreground text-sm">Nog geen leden gevonden.</p>
              )}
              {!loading && members && members.length > 0 && (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>E-mail</TableHead>
                        <TableHead>Naam</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Laatste login</TableHead>
                        <TableHead>Acties</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.userId}>
                          <TableCell className="font-medium">
                            {member.email}
                            {member.isSelf && <span className="ml-2 text-muted-foreground text-xs">(uzelf)</span>}
                            {member.isPlatformAdmin && (
                              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                                platformbeheer
                              </span>
                            )}
                            {member.banned && (
                              <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
                                geblokkeerd
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{member.name || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{ROL_LABELS[member.role]}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {formatMoment(member.lastSignIn)}
                          </TableCell>
                          <TableCell>
                            <MemberActions member={member} onChanged={laadLeden} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nieuw account</CardTitle>
              <CardDescription>
                Het account hoort automatisch bij uw organisatie en ziet dezelfde dashboarddata. Na het aanmaken
                verschijnt een wachtwoord-link die u persoonlijk doorgeeft.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MemberCreateForm onCreated={laadLeden} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
