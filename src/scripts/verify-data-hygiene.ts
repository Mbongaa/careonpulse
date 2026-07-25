/**
 * Fails CI when a real-looking export is tracked outside the committed
 * synthetic fixture directory. It never opens export contents.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

const exportPattern = /(^|\/)(exports?\b|.*(?:client|patient|agenda|declar|toeslag|verwijzer).*).*\.(csv|xlsx?|json)$/i;
const allowed = (file: string) => file.startsWith("src/scripts/fixtures/");
const violations = tracked.filter((file) => exportPattern.test(file) && !allowed(file));

if (violations.length > 0) {
  console.error("FAIL: mogelijk productie-exportbestand wordt door git gevolgd:");
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

const secretPatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{24,}\b/g,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
];
const textFiles = tracked.filter(
  (file) => !file.endsWith("package-lock.json") && !/\.(?:png|jpe?g|gif|webp|ico|woff2?|pdf|xlsx?)$/i.test(file),
);
const secretViolations: string[] = [];
for (const file of textFiles) {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    secretViolations.push(file);
  }
  for (const pattern of secretPatterns) pattern.lastIndex = 0;
}
if (secretViolations.length > 0) {
  console.error("FAIL: mogelijk geheim wordt door git gevolgd:");
  for (const file of secretViolations) console.error(`- ${file}`);
  process.exit(1);
}

console.log(
  `Data hygiene verification: ${tracked.length} tracked files checked; no production exports or real-looking secrets tracked.`,
);
