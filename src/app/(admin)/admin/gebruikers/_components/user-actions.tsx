"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isCareonHostedDemoEmail } from "@/lib/careon-demo-account";
import { CAREON_PASSWORD_HINT, isStrongCareonPassword } from "@/lib/careon-password";

import { AdminActieMelding } from "../../_components/admin-ui";

export interface UserActionMembership {
  orgId: string;
  orgName: string;
  role: "org_admin" | "member";
}

// Volledige levensloop van een account (spec §8): naast wachtwoord en
// blokkeren ook promoveren/degraderen, koppelen/ontkoppelen, de platformrol en
// verwijderen. De onomkeerbare acties zitten achter "Meer" plus een
// bevestiging; het vaste demoaccount en het eigen account blijven beschermd.
export function UserActions({
  userId,
  email,
  fullName = "",
  banned,
  isSelf,
  isPlatformAdmin,
  platformRolBekend = true,
  memberships,
  organizations,
}: Readonly<{
  userId: string;
  email: string;
  /** Huidige weergavenaam — voorvulling van de naamprompt. */
  fullName?: string;
  banned: boolean;
  isSelf: boolean;
  isPlatformAdmin: boolean;
  /**
   * False wanneer de platform_admins-read mislukte: isPlatformAdmin is dan een
   * gok, en de knop zou "Maak platformbeheerder" aanbieden voor iemand die de
   * rol al heeft — dan liever geen knop.
   */
  platformRolBekend?: boolean;
  memberships: UserActionMembership[];
  organizations: { id: string; name: string }[];
}>) {
  const router = useRouter();
  const protectedDemoAccount = isCareonHostedDemoEmail(email);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "fout"; tekst: string } | null>(null);
  const beschikbareOrganisaties = organizations.filter(
    (org) => !memberships.some((membership) => membership.orgId === org.id),
  );
  const [gekozenOrg, setGekozenOrg] = useState("");
  // De keuze wordt bij elke render tegen de actuele lijst gehouden: na een
  // geslaagde koppeling verdwijnt die organisatie uit de opties terwijl de state
  // haar id nog vasthoudt — de select rendert dan leeg en de knop verstuurt
  // alsnog het inmiddels ongeldige id.
  const nieuweOrg = beschikbareOrganisaties.some((org) => org.id === gekozenOrg)
    ? gekozenOrg
    : (beschikbareOrganisaties[0]?.id ?? "");
  const [nieuweRol, setNieuweRol] = useState<"member" | "org_admin">("member");
  // De rolkeuze staat lokaal: een select die alleen de servergegevens spiegelt,
  // springt tijdens de aanvraag zichtbaar terug naar de oude rol.
  const [rollen, setRollen] = useState<Record<string, UserActionMembership["role"]>>(() =>
    Object.fromEntries(memberships.map((membership) => [membership.orgId, membership.role] as const)),
  );

  async function call(body: Record<string, unknown>, confirmText?: string): Promise<boolean> {
    if (busy) return false;
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(
        response.ok ? { tone: "ok", tekst: "Gelukt." } : { tone: "fout", tekst: payload?.error ?? "Actie mislukt." },
      );
      if (response.ok) router.refresh();
      return response.ok;
    } finally {
      setBusy(false);
    }
  }

  async function wijzigRol(membership: UserActionMembership, waarde: string) {
    const nieuw: UserActionMembership["role"] = waarde === "org_admin" ? "org_admin" : "member";
    const vorige = rollen[membership.orgId] ?? membership.role;
    setRollen((huidig) => ({ ...huidig, [membership.orgId]: nieuw }));
    const gelukt = await call({ action: "set_role", orgId: membership.orgId, role: nieuw });
    if (!gelukt) setRollen((huidig) => ({ ...huidig, [membership.orgId]: vorige }));
  }

  // Naam en e-mailadres waren alleen met SQL te herstellen; een typefout bij
  // het aanmaken was daarmee permanent. Zelfde promptpatroon als het
  // wachtwoord, zodat de rij compact blijft.
  function wijzigNaam() {
    const naam = window.prompt(`Nieuwe weergavenaam voor ${email}.`, fullName);
    if (naam === null) return;
    if (naam.trim() === "") {
      setMessage({ tone: "fout", tekst: "Vul een naam in." });
      return;
    }
    void call({ action: "set_name", fullName: naam.trim() });
  }

  function wijzigEmail() {
    const nieuw = window.prompt(`Nieuw e-mailadres voor ${email}. Dit is ook de inlognaam.`, email);
    if (nieuw === null) return;
    const genormaliseerd = nieuw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(genormaliseerd)) {
      setMessage({ tone: "fout", tekst: "Ongeldig e-mailadres." });
      return;
    }
    if (genormaliseerd === email.trim().toLowerCase()) return;
    void call(
      { action: "set_email", email: genormaliseerd },
      `Inlognaam van ${email} wijzigen naar ${genormaliseerd}? De gebruiker logt daarna met het nieuwe adres in.`,
    );
  }

  function resetPassword() {
    const password = window.prompt(`Nieuw wachtwoord voor ${email}. ${CAREON_PASSWORD_HINT}`);
    if (!password) return;
    if (!isStrongCareonPassword(password)) {
      setMessage({ tone: "fout", tekst: CAREON_PASSWORD_HINT });
      return;
    }
    void call({ action: "reset_password", password });
  }

  return (
    <div className="flex min-w-56 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" disabled={busy || protectedDemoAccount} onClick={resetPassword}>
          Wachtwoord
        </Button>
        {/* title op de omhullende span: een disabled knop krijgt door
            disabled:pointer-events-none geen hover, dus daar zou de uitleg
            onzichtbaar blijven. */}
        <span title={isPlatformAdmin && !banned ? "Trek eerst de platformbeheerrol in." : undefined}>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || isSelf || (protectedDemoAccount && !banned) || (isPlatformAdmin && !banned)}
            onClick={() =>
              call(
                { action: banned ? "unban" : "ban" },
                banned ? undefined : `${email} blokkeren? De gebruiker kan dan niet meer inloggen.`,
              )
            }
          >
            {banned ? "Deblokkeer" : "Blokkeer"}
          </Button>
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Minder" : "Meer"}
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-2 rounded-lg border p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={busy || protectedDemoAccount} onClick={wijzigNaam}>
              Naam wijzigen
            </Button>
            <Button size="sm" variant="outline" disabled={busy || protectedDemoAccount} onClick={wijzigEmail}>
              E-mail wijzigen
            </Button>
          </div>

          {memberships.map((membership) => (
            <div key={membership.orgId} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{membership.orgName}</span>
              <select
                aria-label={`Rol van ${email} in ${membership.orgName}`}
                value={rollen[membership.orgId] ?? membership.role}
                disabled={busy || protectedDemoAccount}
                onChange={(event) => {
                  void wijzigRol(membership, event.target.value);
                }}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs"
              >
                <option value="member">Gebruiker</option>
                <option value="org_admin">Organisatiebeheerder</option>
              </select>
              {/* Ook voor het eigen account: sinds zelf-koppelen kan, moet
                  zelf-ontkoppelen ook — anders is een proefkoppeling een
                  eenrichtingsdeur. Een platformbeheerder logt zonder
                  lidmaatschap gewoon in via de platformrol. */}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || protectedDemoAccount}
                onClick={() =>
                  call(
                    { action: "remove_membership", orgId: membership.orgId },
                    `${email} loskoppelen van ${membership.orgName}? Zonder organisatie kan deze gebruiker niet meer inloggen.`,
                  )
                }
              >
                Ontkoppel
              </Button>
            </div>
          ))}

          {beschikbareOrganisaties.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <select
                aria-label={`Organisatie koppelen aan ${email}`}
                value={nieuweOrg}
                onChange={(event) => setGekozenOrg(event.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs"
              >
                {beschikbareOrganisaties.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Rol bij koppelen van ${email}`}
                value={nieuweRol}
                onChange={(event) => setNieuweRol(event.target.value === "org_admin" ? "org_admin" : "member")}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs"
              >
                <option value="member">Gebruiker</option>
                <option value="org_admin">Organisatiebeheerder</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || protectedDemoAccount || nieuweOrg === ""}
                onClick={() => call({ action: "add_membership", orgId: nieuweOrg, role: nieuweRol })}
              >
                Koppel
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {/* title op de span: de uitgeschakelde knop zelf krijgt door
                disabled:pointer-events-none nooit een hover, dus een title
                dáárop zou onzichtbaar blijven. */}
            <span title={platformRolBekend ? undefined : "Platformrollen konden niet worden gelezen."}>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || protectedDemoAccount || (isSelf && isPlatformAdmin) || !platformRolBekend}
                onClick={() =>
                  call(
                    { action: isPlatformAdmin ? "revoke_platform_admin" : "grant_platform_admin" },
                    isPlatformAdmin
                      ? `Platformbeheerrol van ${email} intrekken?`
                      : `${email} platformbeheerder maken? Deze rol geeft toegang tot álle organisaties en AI-gesprekken.`,
                  )
                }
              >
                {isPlatformAdmin ? "Platformrol intrekken" : "Maak platformbeheerder"}
              </Button>
            </span>
            {/* Zelfde volgorde als blokkeren: eerst de platformrol intrekken. */}
            <span title={isPlatformAdmin ? "Trek eerst de platformbeheerrol in." : undefined}>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || isSelf || protectedDemoAccount || isPlatformAdmin}
                onClick={() =>
                  call(
                    { action: "delete_user" },
                    // De cascade uit migratie 0011 hangt aan profiles, dus met
                    // het account gaan ook de AI-gesprekken weg; audit-rijen
                    // blijven staan maar verliezen hun gebruiker (0012, on
                    // delete set null). Dat moet in de bevestiging staan —
                    // anders verwijdert een beheerder ongemerkt het
                    // gespreksarchief mee.
                    `${email} definitief verwijderen? Het account, alle lidmaatschappen en alle AI-gesprekken van deze gebruiker worden verwijderd. Audit-rijen blijven bewaard, maar zijn daarna niet meer aan dit account gekoppeld. Dit kan niet ongedaan worden gemaakt.`,
                  )
                }
              >
                Verwijder account
              </Button>
            </span>
          </div>
        </div>
      )}

      {protectedDemoAccount && <span className="text-muted-foreground text-xs">Vast demoaccount</span>}
      {isSelf && <span className="text-muted-foreground text-xs">Dit is uw eigen account</span>}
      {message && <AdminActieMelding tone={message.tone}>{message.tekst}</AdminActieMelding>}
    </div>
  );
}
