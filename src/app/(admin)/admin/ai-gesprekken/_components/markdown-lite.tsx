import type { ReactNode } from "react";

// Compacte markdown-weergave voor de leesmodus van beheer. De assistent
// antwoordt in markdown; als platte tekst leest een transcript met koppen,
// lijsten en codeblokken als ruis. Bewust géén HTML-injectie: alles wordt als
// React-elementen opgebouwd, dus opmaak kan nooit script worden.

type Blok =
  | { soort: "alinea"; regels: string[] }
  | { soort: "kop"; tekst: string }
  | { soort: "lijst"; geordend: boolean; items: string[] }
  | { soort: "code"; regels: string[] }
  | { soort: "tabel"; kop: string[]; rijen: string[][] };

function splitsCellen(regel: string): string[] {
  // Alleen op ONontsnapte pipes splitsen: GFM staat `\|` binnen een cel toe,
  // en naïef splitsen schoof dan de hele rij een kolom op.
  return regel
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cel) => cel.trim().replace(/\\\|/g, "|"));
}

/** De scheidingsregel onder de tabelkop: alleen streepjes en optionele dubbele punten. */
function isTabelScheiding(regel: string): boolean {
  const cellen = splitsCellen(regel);
  return cellen.length > 0 && cellen.every((cel) => /^:?-+:?$/.test(cel));
}

function parseBlokken(bron: string): Blok[] {
  const blokken: Blok[] = [];
  let alinea: string[] = [];
  let lijst: { geordend: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let tabel: string[] | null = null;

  const sluitAlinea = () => {
    if (alinea.length > 0) blokken.push({ soort: "alinea", regels: alinea });
    alinea = [];
  };
  const sluitLijst = () => {
    if (lijst) blokken.push({ soort: "lijst", ...lijst });
    lijst = null;
  };
  const sluitTabel = () => {
    if (!tabel) return;
    // Pas een echte tabel bij kop + scheidingsregel; anders is het gewoon
    // tekst met pipes — die gaat door in de open alineabuffer, zodat één
    // doorlopende paragraaf niet in losse <p>'s uiteenvalt. Daarom sluit de
    // alinea pas hiér (vlak vóór een échte tabel), niet al bij de eerste pipe.
    if (tabel.length >= 2 && isTabelScheiding(tabel[1])) {
      sluitAlinea();
      sluitLijst();
      blokken.push({ soort: "tabel", kop: splitsCellen(tabel[0]), rijen: tabel.slice(2).map(splitsCellen) });
    } else {
      alinea.push(...tabel);
    }
    tabel = null;
  };

  for (const regel of bron.replace(/\r\n/g, "\n").split("\n")) {
    if (regel.trimStart().startsWith("```")) {
      if (code) {
        blokken.push({ soort: "code", regels: code });
        code = null;
      } else {
        sluitTabel();
        sluitAlinea();
        sluitLijst();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(regel);
      continue;
    }
    // Tabellen zijn het vaste antwoordformaat van de assistent; als platte
    // tekst stortte een tabel in tot één regel ruwe pipes. De alinea blijft
    // hier bewust open: sluitTabel beslist pas of dit een tabel of tekst was.
    if (/^\s*\|/.test(regel)) {
      if (!tabel) tabel = [];
      tabel.push(regel);
      continue;
    }
    sluitTabel();
    if (regel.trim() === "") {
      sluitAlinea();
      sluitLijst();
      continue;
    }
    const kop = /^#{1,6}\s+(.*)$/.exec(regel);
    if (kop) {
      sluitAlinea();
      sluitLijst();
      blokken.push({ soort: "kop", tekst: kop[1] });
      continue;
    }
    const opsomming = /^\s*[-*]\s+(.*)$/.exec(regel);
    const genummerd = /^\s*\d+[.)]\s+(.*)$/.exec(regel);
    if (opsomming || genummerd) {
      sluitAlinea();
      const geordend = Boolean(genummerd);
      const item = (opsomming ?? genummerd)?.[1] ?? "";
      if (lijst && lijst.geordend === geordend) lijst.items.push(item);
      else {
        sluitLijst();
        lijst = { geordend, items: [item] };
      }
      continue;
    }
    sluitLijst();
    alinea.push(regel);
  }
  if (code) blokken.push({ soort: "code", regels: code });
  sluitTabel();
  sluitAlinea();
  sluitLijst();
  return blokken;
}

// De link-URL mag één niveau gebalanceerde haakjes bevatten (Wikipedia-stijl
// `/wiki/X_(Y)`); zonder dat brak de match op de binnenste `)` en bleef er een
// losse `)` als tekst achter.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:[^()]|\([^()]*\))+\)|\*[^*]+\*)/g;
const LINK_EXACT = /^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)$/;

function inline(tekst: string, sleutel: string): ReactNode[] {
  return tekst.split(INLINE).map((deel, index) => {
    const key = `${sleutel}-${index}`;
    const link = LINK_EXACT.exec(deel);
    if (link) {
      const doel = link[2].trim();
      // Alleen http(s) wordt een echte link; al het andere (mailto:,
      // javascript:, relatieve paden) rendert als kale tekst.
      if (/^https?:\/\//i.test(doel)) {
        return (
          <a
            key={key}
            href={doel}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {link[1]}
          </a>
        );
      }
      return <span key={key}>{link[1]}</span>;
    }
    if (deel.startsWith("**") && deel.endsWith("**") && deel.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {deel.slice(2, -2)}
        </strong>
      );
    }
    if (deel.startsWith("`") && deel.endsWith("`") && deel.length > 2) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-xs">
          {deel.slice(1, -1)}
        </code>
      );
    }
    if (deel.startsWith("*") && deel.endsWith("*") && deel.length > 2) {
      return <em key={key}>{deel.slice(1, -1)}</em>;
    }
    return <span key={key}>{deel}</span>;
  });
}

export function MarkdownLite({ bron }: Readonly<{ bron: string }>) {
  const blokken = parseBlokken(bron);
  return (
    <div className="flex flex-col gap-2">
      {blokken.map((blok, index) => {
        const sleutel = `blok-${index}`;
        if (blok.soort === "kop") {
          return (
            <p key={sleutel} className="font-semibold">
              {inline(blok.tekst, sleutel)}
            </p>
          );
        }
        if (blok.soort === "code") {
          return (
            <pre key={sleutel} className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
              <code>{blok.regels.join("\n")}</code>
            </pre>
          );
        }
        if (blok.soort === "lijst") {
          const ListTag = blok.geordend ? "ol" : "ul";
          return (
            <ListTag key={sleutel} className={blok.geordend ? "list-inside list-decimal" : "list-inside list-disc"}>
              {blok.items.map((item, itemIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: opmaak uit een vaste tekst — de positie ís de identiteit en de lijst muteert nooit.
                <li key={`${sleutel}-${itemIndex}`}>{inline(item, `${sleutel}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        if (blok.soort === "tabel") {
          return (
            <div key={sleutel} className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    {blok.kop.map((cel, celIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: opmaak uit een vaste tekst — de positie ís de identiteit en de tabel muteert nooit.
                      <th key={`${sleutel}-kop-${celIndex}`} className="py-1.5 pr-3 font-medium">
                        {inline(cel, `${sleutel}-kop-${celIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blok.rijen.map((rij, rijIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: opmaak uit een vaste tekst — de positie ís de identiteit en de tabel muteert nooit.
                    <tr key={`${sleutel}-rij-${rijIndex}`} className="border-b last:border-0">
                      {rij.map((cel, celIndex) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: opmaak uit een vaste tekst — de positie ís de identiteit en de tabel muteert nooit.
                        <td key={`${sleutel}-rij-${rijIndex}-${celIndex}`} className="py-1.5 pr-3 align-top">
                          {inline(cel, `${sleutel}-rij-${rijIndex}-${celIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // whitespace-pre-wrap: zachte regeleinden binnen een alinea bleven
        // eerder niet bewaard, waardoor meerregelige antwoorden aan elkaar
        // plakten.
        return (
          <p key={sleutel} className="whitespace-pre-wrap">
            {inline(blok.regels.join("\n"), sleutel)}
          </p>
        );
      })}
    </div>
  );
}
