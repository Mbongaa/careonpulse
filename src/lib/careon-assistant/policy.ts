const SENSITIVE_ATTRIBUTE =
  /\b(taal|tweede taal|moedertaal|nationaliteit|afkomst|etniciteit|religie|geloof|seksuele voorkeur|geaardheid)\b/i;
const PROXY_BASIS =
  /\b(op basis van|aan de hand van|afleiden uit|inschatten (?:op|aan) de hand van|raad|vermoed)\b[\s\S]{0,80}\b(naam|achternaam|voornaam|foto|uiterlijk)\b|\b(naam|achternaam|voornaam|foto|uiterlijk)\b[\s\S]{0,80}\b(op basis van|aan de hand van|afleiden|inschatten|raad|vermoed)/i;

/**
 * Blocks instructions that ask the assistant to infer a sensitive attribute
 * from a proxy such as a person's name. Explicitly registered facts remain
 * usable; this only covers unsupported inference.
 */
export function isSensitiveProxyInference(question: string): boolean {
  return SENSITIVE_ATTRIBUTE.test(question) && PROXY_BASIS.test(question);
}
