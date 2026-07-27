"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { CircleHelp, ClipboardList, Database, File, Search, Settings, UserPlus } from "lucide-react";
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
import { CAREON_ORG } from "@/data/careon/careon-filters";
import { rootUser } from "@/data/users";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { CareonLogo } from "../careon/careon-logo";
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

  // Gebruikersbeheer (handoff 13, fase 6) alleen tonen aan organisatie-
  // beheerders; in demo-modus (501) of voor gewone leden blijft de sidebar
  // exact het geauditeerde origineel. Zelfde sessie-probe als nav-user.
  const [beheerZichtbaar, setBeheerZichtbaar] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { orgRole?: string; isSuperadmin?: boolean } | null) => {
        if (payload?.orgRole === "org_admin" || payload?.isSuperadmin) setBeheerZichtbaar(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const navItems = useMemo(() => {
    if (!beheerZichtbaar) return sidebarItems;
    return sidebarItems.map((group) =>
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
  }, [beheerZichtbaar]);

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
            <span className="text-muted-foreground text-xs">{CAREON_ORG.customerChip}</span>
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
