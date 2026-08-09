import { NextResponse } from "next/server";

import {
  CONTACT_SELECT,
  type ContactRij,
  serviceRestHeaders,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { isMiddelenState } from "@/lib/careon-middelen/types";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

// Medewerkers als contactcategorie (handoff 15 §3.4): read-only unie van de
// dashboardaccounts (echte e-mails, alleen accounthouders) en het
// middelenregister (functie/teams, accountEmail vaak leeg). Samengevoegd op
// e-mail, anders op naam; uit dienst valt weg. Geen sync, geen schrijfacties
// richting careon_middelen_state.

interface MedewerkerUnie {
  naam: string;
  functie?: string;
  email?: string;
  teams?: string[];
  userId?: string;
  alContact: boolean;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

async function accountEmail(userId: string): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: serviceRestHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const record = (await response.json()) as { email?: string };
  return typeof record.email === "string" ? record.email : null;
}

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }

  try {
    // Accounts van deze organisatie (service-role: memberships + namen).
    const ledenResponse = await fetch(
      `${POSTGREST_URL}/organization_members?org_id=eq.${session.orgId}&select=user_id,profiles(full_name)`,
      { headers: serviceRestHeaders(), cache: "no-store" },
    );
    if (!ledenResponse.ok) throw new Error("storage-unavailable");
    const leden = (await ledenResponse.json()) as {
      user_id: string;
      profiles?: { full_name?: string } | { full_name?: string }[] | null;
    }[];

    const perSleutel = new Map<string, MedewerkerUnie>();
    const zetOfMerge = (sleutel: string, waarde: MedewerkerUnie) => {
      const bestaand = perSleutel.get(sleutel);
      if (!bestaand) {
        perSleutel.set(sleutel, waarde);
        return;
      }
      bestaand.functie = bestaand.functie ?? waarde.functie;
      bestaand.teams = bestaand.teams ?? waarde.teams;
      bestaand.email = bestaand.email ?? waarde.email;
      bestaand.userId = bestaand.userId ?? waarde.userId;
    };

    // E-mails per account (GoTrue admin, begrensd parallel).
    for (let start = 0; start < leden.length; start += 10) {
      const batch = leden.slice(start, start + 10);
      const emails = await Promise.all(batch.map((lid) => accountEmail(lid.user_id)));
      batch.forEach((lid, index) => {
        const profiel = Array.isArray(lid.profiles) ? lid.profiles[0] : lid.profiles;
        const naam = (profiel?.full_name ?? "").trim();
        const email = emails[index]?.trim().toLowerCase() ?? undefined;
        if (!naam && !email) return;
        zetOfMerge(email ?? `naam:${naam.toLowerCase()}`, {
          naam: naam || (email as string),
          email,
          userId: lid.user_id,
          alContact: false,
        });
      });
    }

    // Middelenregister (caller-JWT: leden mogen dit zelf al lezen).
    const middelenResponse = await fetch(
      `${POSTGREST_URL}/careon_middelen_state?org_id=eq.${session.orgId}&select=state&order=revision.desc&limit=1`,
      { headers: userRestHeaders(session), cache: "no-store" },
    );
    if (middelenResponse.ok) {
      const rows = (await middelenResponse.json()) as { state: unknown }[];
      const state = rows[0]?.state;
      if (isMiddelenState(state)) {
        for (const medewerker of state.medewerkers) {
          if (medewerker.uitDienst) continue;
          const email = medewerker.accountEmail?.trim().toLowerCase();
          const sleutel = email ?? `naam:${medewerker.naam.trim().toLowerCase()}`;
          zetOfMerge(sleutel, {
            naam: medewerker.naam,
            functie: medewerker.functie,
            teams: medewerker.teams,
            email,
            alContact: false,
          });
        }
      }
    }

    // Bestaande medewerker-contacten markeren (caller-JWT).
    const contactenResponse = await fetch(
      `${POSTGREST_URL}/careon_facturatie_contacten?org_id=eq.${session.orgId}&soort=eq.medewerker&select=${CONTACT_SELECT}`,
      { headers: userRestHeaders(session), cache: "no-store" },
    );
    if (contactenResponse.ok) {
      const contacten = (await contactenResponse.json()) as ContactRij[];
      for (const contact of contacten) {
        const email = contact.email?.trim().toLowerCase();
        const viaEmail = email ? perSleutel.get(email) : undefined;
        const viaNaam = perSleutel.get(`naam:${(contact.medewerker_naam ?? contact.naam).trim().toLowerCase()}`);
        const doel = viaEmail ?? viaNaam;
        if (doel) doel.alContact = true;
      }
    }

    const medewerkers = [...perSleutel.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
    return NextResponse.json({ configured: true, medewerkers });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
