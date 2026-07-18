// biome-ignore lint/correctness/noUndeclaredDependencies: sharp wordt meegeleverd met Next; geen extra (platformspecifieke) dependency toevoegen voor dit eenmalige generatorscript.
import sharp from "sharp";

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Genereert alle app-iconen uit het "C · Open Beat"-brandmerk (zie
// careon-logo.tsx / Claude Design "Careon Pulse Logo Final"). Draaien met:
//   node src/scripts/generate-brand-icons.mjs
// Schrijft: public/icons/*.png, src/app/favicon.ico en src/app/icon.svg.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GRADIENT_START = "#1E88FF";
const GRADIENT_END = "#A020F0";
const BG_EDGE = "#07091a"; // = manifest background_color
const BG_CENTER = "#1d2038"; // opgelicht centrum, zoals de radial in het ontwerp

// Padbereik in het 100-viewBox-ontwerp (incl. lijndikte): x −0,5…95,25 / y 9,5…90,5.
// translate(2.6 0) centreert dat bereik; `scale` bepaalt de fractie van het canvas.
const markGroup = (scale) => `
  <g transform="translate(50 50) scale(${scale}) translate(-47.4 -50)">
    <path d="M74 24 A34 34 0 1 0 74 76" fill="none" stroke="url(#careon-g)" stroke-width="13" stroke-linecap="round"/>
    <path d="M52 50 h6 l4 -15 l6 28 l4 -13 h20" fill="none" stroke="url(#careon-g)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const gradientDef = `
    <linearGradient id="careon-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GRADIENT_START}"/>
      <stop offset="0.55" stop-color="${GRADIENT_END}"/>
    </linearGradient>`;

// background: "none" (transparant), "tile" (afgeronde donkere tegel voor de
// gewone PWA-iconen) of "full" (volledig gevuld voor maskable/apple).
function markSvg({ size, fraction, background }) {
  const scale = (100 * fraction) / 95.75;
  const shapes = {
    none: "",
    tile: `<rect width="100" height="100" rx="22" fill="url(#careon-bg)"/>`,
    full: `<rect width="100" height="100" fill="url(#careon-bg)"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <title>Careon Pulse</title>
  <defs>${gradientDef}
    <radialGradient id="careon-bg" cx="0.5" cy="0.44" r="0.74">
      <stop offset="0" stop-color="${BG_CENTER}"/>
      <stop offset="1" stop-color="${BG_EDGE}"/>
    </radialGradient>
  </defs>
  ${shapes[background]}${markGroup(scale)}
</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

// ICO-container met PNG-entries (door alle moderne browsers ondersteund).
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // kleurvlakken
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.buf)]);
}

const jobs = [
  ["public/icons/icon-192.png", { size: 192, fraction: 0.72, background: "tile" }],
  ["public/icons/icon-512.png", { size: 512, fraction: 0.72, background: "tile" }],
  ["public/icons/icon-maskable-192.png", { size: 192, fraction: 0.56, background: "full" }],
  ["public/icons/icon-maskable-512.png", { size: 512, fraction: 0.56, background: "full" }],
  ["public/icons/apple-touch-icon.png", { size: 180, fraction: 0.66, background: "full" }],
];

for (const [rel, opts] of jobs) {
  await writeFile(path.join(root, rel), await png(markSvg(opts)));
  console.log(`✓ ${rel}`);
}

const faviconSizes = [16, 32, 48];
const faviconEntries = await Promise.all(
  faviconSizes.map(async (size) => ({
    size,
    buf: await png(markSvg({ size, fraction: 0.98, background: "none" })),
  })),
);
await writeFile(path.join(root, "src/app/favicon.ico"), buildIco(faviconEntries));
console.log("✓ src/app/favicon.ico");

await writeFile(path.join(root, "src/app/icon.svg"), `${markSvg({ size: 100, fraction: 0.98, background: "none" })}\n`);
console.log("✓ src/app/icon.svg");
