import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

// Remembers this device's sign-in so the access key is needed once per device.
const KEY = "openmuse.session";
const file = () =>
  FileSystem.documentDirectory ? `${FileSystem.documentDirectory}openmuse-session.json` : undefined;

export async function loadSession(): Promise<string | undefined> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? undefined;
    const path = file();
    if (!path || !(await FileSystem.getInfoAsync(path)).exists) return undefined;
    const saved = JSON.parse(await FileSystem.readAsStringAsync(path)) as { token?: unknown };
    return typeof saved.token === "string" ? saved.token : undefined;
  } catch {
    return undefined;
  }
}
export async function saveSession(token: string) {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, token);
    else {
      const path = file();
      if (path) await FileSystem.writeAsStringAsync(path, JSON.stringify({ token }));
    }
  } catch {
    // Private browsing or blocked storage: this device just asks for the key next time.
  }
}
export async function clearSession() {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.removeItem(KEY);
    else {
      const path = file();
      if (path) await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch {
    // Nothing saved to remove.
  }
}
/**
 * A sign-in link (https://…/#key=…) carries the access key in the URL fragment, which browsers
 * never send to a server. The key is removed from the address bar right away.
 */
export function linkAccessKey(): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  const match = /(?:^#|&)key=([^&]+)/.exec(window.location.hash);
  if (!match?.[1]) return undefined;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
