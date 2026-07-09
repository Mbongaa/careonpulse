import {
  BellRing,
  Bot,
  CalendarDays,
  Database,
  FolderKanban,
  FolderSearch,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
} from "lucide-react";

// "alerts" renders the critical-signal count; "source" renders the active
// Databron mode (DEMO/CSV/LIVE). Both read live Careon state in nav-main.
export type NavBadge = "new" | "soon" | "alerts" | "source";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Overzicht",
    items: [
      {
        id: "directiecockpit",
        title: "Directiecockpit",
        url: "/dashboard/directiecockpit",
        icon: LayoutDashboard,
      },
      {
        id: "signaleringen",
        title: "Signaleringen",
        url: "/dashboard/signaleringen",
        icon: BellRing,
        badge: "alerts",
      },
      {
        id: "assistent",
        title: "AI-assistent",
        url: "/dashboard/assistent",
        icon: Bot,
        badge: "new",
      },
    ],
  },
  {
    id: 2,
    label: "Zorg",
    items: [
      {
        id: "patienten",
        title: "Patiënten",
        url: "/dashboard/patienten",
        icon: Users,
      },
      {
        id: "planning",
        title: "Planning",
        url: "/dashboard/planning",
        icon: CalendarDays,
      },
      {
        id: "behandelaren",
        title: "Behandelaren",
        url: "/dashboard/behandelaren",
        icon: Stethoscope,
      },
      {
        id: "dossiercontrole",
        title: "Dossiercontrole",
        url: "/dashboard/dossiercontrole",
        icon: FolderSearch,
      },
      {
        id: "dossiers-productie",
        title: "Dossiers & productie",
        url: "/dashboard/dossiers-productie",
        icon: FolderKanban,
        badge: "new",
      },
      {
        id: "kwaliteit",
        title: "Kwaliteit",
        url: "/dashboard/kwaliteit",
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: 3,
    label: "Organisatie",
    items: [
      {
        id: "financieel",
        title: "Financieel",
        url: "/dashboard/financieel",
        icon: Landmark,
      },
      {
        id: "hr",
        title: "HR",
        url: "/dashboard/hr",
        icon: UserCog,
      },
    ],
  },
  {
    id: 4,
    label: "Systeem",
    items: [
      {
        id: "databron",
        title: "Databron",
        url: "/dashboard/databron",
        icon: Database,
        badge: "source",
      },
    ],
  },
];
