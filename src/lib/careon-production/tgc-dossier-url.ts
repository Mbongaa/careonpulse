const TGC_EPD_ORIGIN = "https://tgc.zsg.nl";
const CARECHECK_OPAQUE_ID = "[A-Za-z0-9]{16,64}";
const TGC_DOSSIER_PATHS = [
  new RegExp(`^/dossier/zpm/${CARECHECK_OPAQUE_ID}/${CARECHECK_OPAQUE_ID}$`),
  new RegExp(`^/dossier/uninsured/${CARECHECK_OPAQUE_ID}$`),
];

/**
 * Accept only the two dossier routes observed in TGC's CareCheck export.
 * The exported value is untrusted input: it can become an anchor href in the
 * browser, so an arbitrary HTTPS URL is not sufficient validation.
 */
export function normalizeTgcDossierUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 512 || value.trim() !== value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.origin !== TGC_EPD_ORIGIN ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !TGC_DOSSIER_PATHS.some((path) => path.test(url.pathname))
    ) {
      return null;
    }
    return `${TGC_EPD_ORIGIN}${url.pathname}`;
  } catch {
    return null;
  }
}

export function isTgcDossierUrl(value: unknown): value is string {
  return typeof value === "string" && normalizeTgcDossierUrl(value) === value;
}
