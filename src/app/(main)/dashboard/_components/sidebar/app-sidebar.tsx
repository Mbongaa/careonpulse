"use client";

import { useMemo } from "react";

import Link from "next/link";

import { CircleHelp, ClipboardList, Database, File, ReceiptEuro, Search, Settings, UserPlus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { rootUser } from "@/data/users";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { CareonLogo } from "../careon/careon-logo";
import { useCareonKlantChip, useCareonSessionInfo } from "../careon/careon-session-provider";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";

const _data = {
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: Settings,
    },
    {
      title: "Get Help",
      url: "#",
      icon: CircleHelp,
    },
    {
      title: "Search",
      url: "#",
      icon: Search,
    },
  ],
  documents: [
    {
      name: "Data Library",
      url: "#",
      icon: Database,
    },
    {
      name: "Reports",
      url: "#",
      icon: ClipboardList,
    },
    {
      name: "Word Assistant",
      url: "#",
      icon: File,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.values.sidebar_variant,
      sidebarCollapsible: s.values.sidebar_collapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;

  // Rolafhankelijke navigatie via de server-gezaaide sessiecontext (geen
  // eigen probe meer): Gebruikersbeheer (handoff 13, fase 6) alleen voor
  // organisatiebeheerders, en Financieel verdwijnt voor gewone leden
  // (klantbesluit 28-07-2026). In demo-modus blijft de sidebar het
  // geauditeerde origineel.
  const { orgRole, isSuperadmin, financieelZichtbaar, facturatieZichtbaar } = useCareonSessionInfo();
  // Klantregel uit de sessie: klant 2 hoort hier niet de naam van klant 1 te lezen.
  const klantChip = useCareonKlantChip();
  const beheerZichtbaar = orgRole === "org_admin" || isSuperadmin;
  const navItems = useMemo(() => {
    let groups = sidebarItems;
    if (!financieelZichtbaar) {
      groups = groups.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.id !== "financieel"),
      }));
    }
    // Facturatie (handoff 15): beheerdersmodule, runtime-gefilterd zoals
    // Gebruikersbeheer hieronder. Label en route staan daarmee — aanvaard —
    // in de clientbundel; de afscherming zit in paginagate, API en RLS.
    if (facturatieZichtbaar) {
      groups = groups.map((group) =>
        group.label === "Organisatie"
          ? {
              ...group,
              items: [
                ...group.items,
                { id: "facturatie", title: "Facturatie", url: "/dashboard/facturatie", icon: ReceiptEuro },
              ],
            }
          : group,
      );
    }
    if (!beheerZichtbaar) return groups;
    return groups.map((group) =>
      group.label === "Systeem"
        ? {
            ...group,
            items: [
              ...group.items,
              { id: "beheer", title: "Gebruikersbeheer", url: "/dashboard/beheer", icon: UserPlus },
            ],
          }
        : group,
    );
  }, [beheerZichtbaar, financieelZichtbaar, facturatieZichtbaar]);

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Bewust geen SidebarMenuButton: die dwingt h-8 en [&_svg]:size-4 af
                en verplettert het merkteken — het logo-lockup bepaalt zelf zijn maat. */}
            <Link
              prefetch={false}
              href="/dashboard/directiecockpit"
              className="flex items-center rounded-md px-2 py-2 outline-hidden ring-sidebar-ring focus-visible:ring-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-1"
            >
              <CareonLogo compact={false} />
              <span className="sr-only">{APP_CONFIG.name}</span>
            </Link>
          </SidebarMenuItem>
          <SidebarMenuItem className="careon-client-chip mx-2 px-2 py-2 group-data-[collapsible=icon]:hidden">
            <span className="text-muted-foreground text-xs">{klantChip}</span>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
        {/* <NavDocuments items={data.documents} /> */}
        {/* <NavSecondary items={data.navSecondary} className="mt-auto" /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={rootUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
