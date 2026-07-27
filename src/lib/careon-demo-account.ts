export const CAREON_HOSTED_DEMO_USERNAME = "user1";
export const CAREON_HOSTED_DEMO_EMAIL_DOMAIN = "careon-demo.nl";
export const CAREON_HOSTED_DEMO_EMAIL = `${CAREON_HOSTED_DEMO_USERNAME}@${CAREON_HOSTED_DEMO_EMAIL_DOMAIN}`;

export function isCareonHostedDemoEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === CAREON_HOSTED_DEMO_EMAIL;
}
