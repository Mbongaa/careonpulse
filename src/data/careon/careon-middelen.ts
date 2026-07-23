import { Car, DoorOpen, Fuel, KeyRound, Laptop, type LucideIcon, Smartphone } from "lucide-react";

import type { MiddelenState, MiddelType, TeamDefinitie } from "@/lib/careon-middelen/types";

// Middelen & inventaris — client-requested handmatige registratie (handoff 09).
// Deze pagina is NIET onderdeel van de originele audit; de demo-seed hieronder
// is voorbeelddata voor demo-modus. In productie start de registratie leeg en
// vult de gebruiker haar zelf; opslag is centraal (Supabase) met
// localStorage-fallback.

export const MIDDEL_LABELS: Record<MiddelType, string> = {
  auto: "Auto",
  tankpas: "Tankpas",
  sleutel: "Sleutel",
  telefoon: "Telefoon",
  laptop: "Laptop",
  toegang: "Gebouwtoegang",
};

export const MIDDEL_ICONS: Record<MiddelType, LucideIcon> = {
  auto: Car,
  tankpas: Fuel,
  sleutel: KeyRound,
  telefoon: Smartphone,
  laptop: Laptop,
  toegang: DoorOpen,
};

// Gecureerde keuzelijsten (functie/talen) staan UI-vrij in de types-module
// zodat de server-side assistent-route ze kan gebruiken; hier re-exporteren
// voor de bestaande UI-imports. Relatief pad: de verify-scripts draaien via
// ts-node zonder de @/-alias op runtime-imports.
export { FUNCTIE_OPTIES, TAAL_OPTIES } from "../../lib/careon-middelen/types";

// Teamstructuur zoals de klant (TGC Groep) haar aanleverde op 2026-07-20:
// teams per Vektis-locatie (De Zorgpoort = TGC Eindhoven, nog niet in de
// EPD-export). Dit is de startstand — de klant beheert de structuur zelf op
// de pagina Medewerkers & middelen ("kan binnen 3 maanden anders uitzien").
export const TEAM_SEED: TeamDefinitie[] = [
  { naam: "SGGZ", locatie: "Tilburg" },
  { naam: "Outreachend", locatie: "Tilburg" },
  { naam: "GGZ in beweging", locatie: "Tilburg" },
  { naam: "RMA/RMO", locatie: "Tilburg" },
  { naam: "SGGZ", locatie: "Roermond" },
  { naam: "Outreachend", locatie: "Roermond" },
  { naam: "RMA/RMO", locatie: "Roermond" },
  { naam: "SGGZ", locatie: "De Zorgpoort" },
  { naam: "Outreachend", locatie: "De Zorgpoort" },
  { naam: "RMA/RMO", locatie: "De Zorgpoort" },
];

// Vaste seed-datum: demo blijft deterministisch (ook voor e2e-assertions).
const SEED_UPDATED_AT = "2026-07-01T09:00:00.000Z";

// Demo-voorbeeldset voor de 10 geauditeerde behandelaren. Auto en tankpas
// zijn paarsgewijs uitgegeven; telefoon/laptop/gebouwtoegang heeft iedereen.
export const DEMO_MIDDELEN_STATE: MiddelenState = {
  medewerkers: [
    {
      naam: "Drs. E. van Dijk",
      middelen: ["auto", "tankpas", "sleutel", "telefoon", "laptop", "toegang"],
      functie: "GZ-psycholoog",
      talen: ["Nederlands", "Engels"],
      notitie: "Kenteken K-482-XL",
    },
    {
      naam: "S. Yılmaz",
      middelen: ["auto", "tankpas", "telefoon", "laptop", "toegang"],
      functie: "Basispsycholoog",
      talen: ["Nederlands", "Turks"],
    },
    {
      naam: "M. Janssen",
      middelen: ["sleutel", "telefoon", "laptop", "toegang"],
      functie: "GZ-psycholoog",
      talen: ["Nederlands"],
    },
    {
      naam: "A. de Boer",
      middelen: ["auto", "tankpas", "sleutel", "telefoon", "laptop", "toegang"],
      functie: "Klinisch psycholoog",
      talen: ["Nederlands", "Engels"],
      notitie: "Kenteken R-291-VD",
    },
    {
      naam: "Dr. R. Chen",
      middelen: ["telefoon", "laptop", "toegang"],
      functie: "Psychiater",
      talen: ["Nederlands", "Engels"],
    },
    {
      naam: "L. Vermeer",
      middelen: ["auto", "tankpas", "sleutel", "telefoon", "laptop", "toegang"],
      functie: "Psychotherapeut",
      talen: ["Nederlands"],
    },
    {
      naam: "K. Aydın",
      middelen: ["telefoon", "laptop", "toegang"],
      functie: "GZ-psycholoog",
      talen: ["Nederlands", "Turks"],
    },
    {
      naam: "J. Willems",
      middelen: ["sleutel", "telefoon", "laptop", "toegang"],
      functie: "Basispsycholoog",
      talen: ["Nederlands", "Engels"],
    },
    {
      naam: "F. el Amrani",
      middelen: ["auto", "tankpas", "telefoon", "laptop", "toegang"],
      functie: "Basispsycholoog",
      talen: ["Nederlands", "Arabisch", "Berbers"],
    },
    {
      naam: "T. Bakker",
      middelen: ["sleutel", "telefoon", "laptop", "toegang"],
      functie: "SPV",
      talen: ["Nederlands"],
    },
    {
      naam: "P. Hendriks",
      handmatig: true,
      middelen: ["sleutel", "toegang"],
      functie: "Overig",
      talen: ["Nederlands"],
      notitie: "Officemanager Tilburg",
    },
  ],
  // Behandelkamers volgen ~ de locatieschaal (0,44/0,34/0,22 van 32 kamers);
  // laptops = voorraad (niet uitgegeven), zelfde schaalverhouding op 36 stuks.
  inventaris: [
    { locatie: "Tilburg", behandelkamers: 14, boeken: 240, diagnostiek: 36, laptops: 16 },
    { locatie: "Breda", behandelkamers: 11, boeken: 175, diagnostiek: 27, laptops: 12 },
    { locatie: "Roermond", behandelkamers: 7, boeken: 110, diagnostiek: 18, laptops: 8 },
  ],
  teams: TEAM_SEED,
  updatedAt: SEED_UPDATED_AT,
};

export const EMPTY_MIDDELEN_STATE: MiddelenState = {
  medewerkers: [],
  inventaris: [],
  teams: TEAM_SEED,
  updatedAt: "1970-01-01T00:00:00.000Z",
};
