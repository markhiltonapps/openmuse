import { useSyncExternalStore } from "react";

/**
 * Whether the phone looks to be in a car right now (owner, 2026-11-08). The server decides (from the speed
 * the phone reports while the app is open); the location reporter hands its answer here, and Home
 * shows the hands-free banner while it's true.
 */
let driving = false;
const listeners = new Set<() => void>();

export function setDriving(next: boolean) {
  if (next === driving) return;
  driving = next;
  for (const listener of listeners) listener();
}

export function isDriving() {
  return driving;
}

export function useDriving() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => driving,
    () => false,
  );
}
