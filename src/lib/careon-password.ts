export const CAREON_PASSWORD_MIN_LENGTH = 12;
export const CAREON_PASSWORD_HINT = "Minimaal 12 tekens met hoofdletter, kleine letter, cijfer en symbool.";

/**
 * Onbedoelde spaties aan begin/einde tellen niet mee — een kopieer- of
 * tikfout mag nooit een onzichtbaar afwijkend wachtwoord opleveren. Spaties
 * bínnen het wachtwoord blijven gewoon geldig (wachtwoordzinnen). Toepassen
 * op élk zet- én controlepunt zodat opslag en login altijd overeenkomen.
 */
export function normalizeCareonPassword(password: string): string {
  return password.trim();
}

export function isStrongCareonPassword(password: string): boolean {
  return (
    password.length >= CAREON_PASSWORD_MIN_LENGTH &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
