import { Platform } from "react-native";

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

let signedOut: (byChoice?: boolean) => void = () => {};
/** Called when the person signs out, or the server no longer accepts this device's sign-in. */
export function onSignedOut(handler: (byChoice?: boolean) => void) {
  signedOut = handler;
  return () => {
    if (signedOut === handler) signedOut = () => {};
  };
}

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const payload = await response.json();
    if (response.status === 401) signedOut();
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`,
      );
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${API_URL}${path}`;
  }
  /** Ends this device's session on the server, then returns to the sign-in screen. */
  async signOut() {
    await this.request("/api/auth/signout", {}).catch(() => undefined);
    signedOut(true);
  }
}

async function post<T>(path: string, body: unknown, failure: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || failure);
  return payload;
}

/** Which ways of signing in this server offers. */
export async function serverInfo(): Promise<{ mode: "sample" | "live"; emailSignIn: boolean }> {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    const payload = await response.json();
    return {
      mode: payload.mode === "live" ? "live" : "sample",
      emailSignIn: !!payload.emailSignIn,
    };
  } catch {
    return { mode: "sample", emailSignIn: false };
  }
}
export function requestSignInLink(email: string) {
  return post<{ ok: true }>("/api/auth/request", { email }, "Could not send the sign-in email.");
}
export function redeemSignInCode(email: string, code: string) {
  return post<{ token: string; mode: "sample" | "live" }>(
    "/api/auth/code",
    { email, code },
    "That code didn't work. Request a new one.",
  );
}
export function redeemSignInLink(token: string) {
  return post<{ token: string; mode: "sample" | "live" }>(
    "/api/auth/verify",
    { token },
    "This sign-in link didn't work. Request a new one.",
  );
}

export function createSession(accessKey?: string) {
  return post<{ token: string; mode: "sample" | "live" }>(
    "/api/session",
    { accessKey },
    "Could not open your workspace.",
  );
}

/** True when the server still accepts a saved sign-in. */
export async function checkSession(token: string) {
  try {
    const response = await fetch(`${API_URL}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
