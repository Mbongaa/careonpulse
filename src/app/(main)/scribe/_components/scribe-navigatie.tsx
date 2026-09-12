"use client";

import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore } from "react";

import Link from "next/link";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Navigatiegrens tijdens een opname (handoff 20 §7.6, N15).
//
// `beforeunload` vuurt alleen bij een écht documentvertrek. De scribeschil
// biedt daarnaast clientnavigatie: de subnav, "Naar modules" en uitloggen.
// Zo'n zachte navigatie ontkoppelt de werkruimte — de microfoon stopt, het
// nog niet ingepakte restant en de wachtrij verdwijnen uit beeld — zonder dat
// de behandelaar iets merkt. Deze module-scope-signaalstore laat de
// werkruimte melden dát er wordt opgenomen, zodat de uitgangen erom kunnen
// vragen voordat ze wegnavigeren.
//
// Bewust GEEN context/provider: de layout (server component) rendert de
// uitgangen buiten de werkruimte, dus een provider zou hier niet omheen
// passen. De store leeft per document en wordt bij het ontkoppelen van de
// werkruimte weer op `false` gezet.

let opnameActiefNu = false;
const luisteraars = new Set<() => void>();

function meld(): void {
  for (const luisteraar of luisteraars) luisteraar();
}

function abonneer(luisteraar: () => void): () => void {
  luisteraars.add(luisteraar);
  return () => {
    luisteraars.delete(luisteraar);
  };
}

/** Zet het signaal; de werkruimte roept dit aan bij elke statuswissel. */
export function zetOpnameActief(actief: boolean): void {
  if (opnameActiefNu === actief) return;
  opnameActiefNu = actief;
  meld();
}

export function opnameActief(): boolean {
  return opnameActiefNu;
}

export function useOpnameActief(): boolean {
  return useSyncExternalStore(
    abonneer,
    () => opnameActiefNu,
    () => false,
  );
}

function VerlaatDialoog({
  open,
  onOpenChange,
  onVerlaten,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onVerlaten: () => void }>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Er staat nog consultwerk open</AlertDialogTitle>
          <AlertDialogDescription>
            Stop de opname en verwerk eerst alle fragmenten en handmatige invoer. Bij verlaten kunnen onverzonden
            audiofragmenten verloren gaan; bij uitloggen wordt ook de handmatige invoer gewist.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Terug naar het consult</AlertDialogCancel>
          <AlertDialogAction onClick={onVerlaten}>Toch verlaten</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Uitgang uit de werkruimte (subnav en "Naar modules"). Loopt er een opname,
 * dan vraagt de link eerst om bevestiging in plaats van stil weg te navigeren.
 */
export function ScribeUitgang({
  href,
  className,
  ariaCurrent,
  children,
}: Readonly<{
  href: string;
  className?: string;
  ariaCurrent?: "page";
  children: ReactNode;
}>) {
  const actief = useOpnameActief();
  const [vraag, setVraag] = useState(false);

  const verlaat = useCallback(() => {
    setVraag(false);
    zetOpnameActief(false);
    window.location.assign(href);
  }, [href]);

  return (
    <>
      <Link
        href={href}
        aria-current={ariaCurrent}
        className={className}
        onClick={(gebeurtenis) => {
          if (!actief) return;
          gebeurtenis.preventDefault();
          setVraag(true);
        }}
      >
        {children}
      </Link>
      <VerlaatDialoog open={vraag} onOpenChange={setVraag} onVerlaten={verlaat} />
    </>
  );
}

/**
 * Grens om de uitlogknop van de schil. `AdminUitloggen` is gedeeld en blijft
 * ongewijzigd; dit omhulsel vangt de klik af zolang er wordt opgenomen —
 * uitloggen beëindigt de sessie en daarmee elke nog openstaande upload.
 */
export function ScribeUitlogGrens({ children }: Readonly<{ children: ReactNode }>) {
  const actief = useOpnameActief();
  const [vraag, setVraag] = useState(false);
  const houderRef = useRef<HTMLSpanElement>(null);

  // Na bevestiging klikt de oorspronkelijke knop alsnog: het signaal is dan
  // uit, dus de tweede klik loopt ongehinderd door de gedeelde uitlogflow.
  const verlaat = useCallback(() => {
    setVraag(false);
    zetOpnameActief(false);
    window.setTimeout(() => houderRef.current?.querySelector("button")?.click(), 0);
  }, []);

  return (
    <>
      {/* Vangt uitsluitend de klik van de ingesloten knop af; de knop zelf
          blijft de bedienbare control, dus er komt geen nieuwe interactie bij
          en toetsenbordbediening loopt gewoon via die knop. */}
      <span
        ref={houderRef}
        onClickCapture={(gebeurtenis) => {
          if (!actief) return;
          gebeurtenis.preventDefault();
          gebeurtenis.stopPropagation();
          setVraag(true);
        }}
      >
        {children}
      </span>
      <VerlaatDialoog open={vraag} onOpenChange={setVraag} onVerlaten={verlaat} />
    </>
  );
}
