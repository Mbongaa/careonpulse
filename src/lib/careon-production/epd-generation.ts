import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const EPD_MANIFEST = ".careon-epd-generation.json";
export const EPD_KEYS = ["client", "agenda", "referrers", "surcharges", "declarations"] as const;
export type EpdKey = (typeof EPD_KEYS)[number];
export type EpdFiles = Record<EpdKey, string>;
interface EpdManifest {
  id: string;
  sourceTime: string;
  files: Record<EpdKey, { name: string; sha256: string }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isManifest(value: unknown): value is EpdManifest {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) ||
    typeof value.sourceTime !== "string" ||
    !Number.isFinite(Date.parse(value.sourceTime)) ||
    !isObject(value.files)
  )
    return false;
  const names = new Set<string>();
  for (const key of EPD_KEYS) {
    const file = value.files[key];
    if (
      !isObject(file) ||
      typeof file.name !== "string" ||
      !file.name ||
      path.basename(file.name) !== file.name ||
      /[\\/]/.test(file.name) ||
      file.name === "." ||
      file.name === ".." ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(file.sha256) ||
      names.has(file.name)
    )
      return false;
    names.add(file.name);
  }
  return true;
}

/** The caller finishes all five immutable files before switching the manifest. */
export function publishEpdManifest(directory: string, files: EpdFiles, sourceTime: string): void {
  const manifest: EpdManifest = { id: randomUUID(), sourceTime, files: {} as EpdManifest["files"] };
  for (const key of EPD_KEYS) {
    if (path.dirname(path.resolve(files[key])) !== path.resolve(directory)) throw new Error("Ongeldig exportpad.");
    manifest.files[key] = {
      name: path.basename(files[key]),
      sha256: createHash("sha256").update(fs.readFileSync(files[key])).digest("hex"),
    };
  }
  if (!isManifest(manifest)) throw new Error("Ongeldig EPD-generatiemanifest.");
  const temporary = path.join(directory, `${EPD_MANIFEST}.${manifest.id}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(manifest), { flag: "wx" });
  fs.renameSync(temporary, path.join(directory, EPD_MANIFEST));
}

/** Exclusive copies prevent same-name retries from corrupting the previous generation. */
export function publishStagedEpdGeneration(directory: string, staged: EpdFiles, sourceTime: string): EpdFiles {
  const published = {} as EpdFiles;
  for (const key of EPD_KEYS) {
    const destination = path.join(directory, path.basename(staged[key]));
    fs.copyFileSync(staged[key], destination, fs.constants.COPYFILE_EXCL);
    published[key] = destination;
  }
  publishEpdManifest(directory, published, sourceTime);
  for (const key of EPD_KEYS) fs.unlinkSync(staged[key]);
  return published;
}

/** Read and hash all five immutable files before parsing or network I/O. */
export function readEpdGeneration(directory: string): { manifest: EpdManifest; texts: Record<EpdKey, string> } {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(directory, EPD_MANIFEST), "utf8"));
  if (!isManifest(manifest)) {
    throw new Error("Ongeldig EPD-generatiemanifest.");
  }
  const texts = {} as Record<EpdKey, string>;
  for (const key of EPD_KEYS) {
    const file = manifest.files[key];
    const bytes = fs.readFileSync(path.join(directory, file.name));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error("EPD-generatie is gewijzigd of onvolledig; voer een volledige synchronisatie uit.");
    }
    texts[key] = bytes.toString("utf8");
  }
  return { manifest, texts };
}
