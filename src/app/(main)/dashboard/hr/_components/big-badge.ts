// Gedeelde weergavelogica voor de BIG-registratie-badge (paneel + editor):
// kleur en label op basis van de resterende dagen tot verval.

export function bigDagenBadgeClass(dagen: number): string {
  if (dagen < 0) return "border-red-600/60 text-red-700 dark:text-red-400";
  if (dagen <= 45) return "border-red-600/40 text-red-700 dark:text-red-400";
  if (dagen <= 90) return "border-amber-600/40 text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

export function bigDagenLabel(dagen: number): string {
  return dagen < 0 ? "verlopen" : `${dagen} dgn`;
}
