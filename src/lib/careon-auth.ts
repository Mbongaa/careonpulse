export const CAREON_AUTH_KEY = "careon-auth";

export const CAREON_DEMO_CREDENTIALS = {
  username: "user1",
  password: "demo1234",
};

export const CAREON_LOGIN_ROUTE = "/auth/v1/login";

export function isCareonAuthed(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(CAREON_AUTH_KEY) === "1";
}

export function careonLogin(): void {
  window.sessionStorage.setItem(CAREON_AUTH_KEY, "1");
}

export function careonLogout(): void {
  window.sessionStorage.removeItem(CAREON_AUTH_KEY);
}
