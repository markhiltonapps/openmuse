import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { HIDDEN } from "./job-working-ui";
import { Card, CheckRow, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Where they are right now, shared from the phone only while the app is open and only when
 * they've turned it on (owner, 2026-10-08). The server keeps the latest spot for an hour, in
 * memory; the home area (weather, local news) is separate.
 */
const REMEMBERED = "location-sharing";
const remembered = () => {
  try {
    return globalThis.localStorage?.getItem(REMEMBERED) === "on";
  } catch {
    return false;
  }
};
const remember = (on: boolean) => {
  try {
    globalThis.localStorage?.setItem(REMEMBERED, on ? "on" : "off");
  } catch {
    // Private mode: the server still knows.
  }
};
const geo = () =>
  Platform.OS === "web" && typeof navigator !== "undefined" ? navigator.geolocation : undefined;
/** About 150 m. */
const moved = (a: GeolocationCoordinates, b: { lat: number; lng: number }) =>
  Math.abs(a.latitude - b.lat) > 0.0014 || Math.abs(a.longitude - b.lng) > 0.0014;

/** Sends the phone's location while the app is open and sharing is on; nothing on screen. */
export function LocationReporter() {
  const { api } = useWorkspace();
  const [on, setOn] = useState(remembered);
  const last = useRef<{ lat: number; lng: number; at: number } | undefined>(undefined);
  // The server decides (it can be turned on or off by voice): checked when the app comes back.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const check = () =>
      void api.request<{ enabled: boolean }>("/api/location").then(
        ({ enabled }) => {
          remember(enabled);
          setOn(enabled);
        },
        () => undefined,
      );
    check();
    // Turned on or off by voice during a call: picked up within half a minute.
    const every = setInterval(() => document.visibilityState === "visible" && check(), 30_000);
    const visible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("location-sharing", check);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("location-sharing", check);
    };
  }, [api]);
  useEffect(() => {
    const where = geo();
    if (!on || !where) return;
    let watch: number | undefined;
    const send = (position: GeolocationPosition) => {
      const c = position.coords;
      const prev = last.current;
      // A new spot, or five minutes since the last: enough for "near me" without chatter.
      if (prev && !moved(c, prev) && Date.now() - prev.at < 5 * 60_000) return;
      last.current = { lat: c.latitude, lng: c.longitude, at: Date.now() };
      void api
        .request("/api/location", { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy })
        .catch(() => undefined);
    };
    const start = () => {
      if (watch !== undefined || document.visibilityState !== "visible") return;
      watch = where.watchPosition(send, () => undefined, {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 30_000,
      });
    };
    const stop = () => {
      if (watch !== undefined) where.clearWatch(watch);
      watch = undefined;
    };
    const visible = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [api, on]);
  return null;
}

/** "3 min ago". */
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
};

/** The switch, on the Account screen. */
export function LocationCard() {
  const { api } = useWorkspace();
  const [view, setView] = useState<{ enabled: boolean; sharedAt: string | null }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [news, setNews] = useState("");
  const load = useCallback(
    () =>
      api
        .request<{ enabled: boolean; sharedAt: string | null }>("/api/location")
        .then(setView, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // A browser that blocks location says so here, instead of the switch quietly sharing nothing.
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || !navigator.permissions?.query) return;
    let status: PermissionStatus | undefined;
    const update = () => setBlocked(status?.state === "denied");
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener("change", update);
  }, []);
  if (!view || !geo()) return null;
  const save = async (on: boolean) => {
    setBusy(true);
    setError("");
    try {
      const next = await api.request<{ enabled: boolean; sharedAt: string | null }>(
        "/api/location/sharing",
        { on },
      );
      remember(on);
      setView(next);
      setNews(on ? "Location sharing on." : "Location sharing off. Where you were is forgotten.");
      window.dispatchEvent(new Event("location-sharing"));
      if (on) setTimeout(() => void load(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const turnOn = () => {
    // Asked during the tap, so the browser shows its question.
    geo()?.getCurrentPosition(
      (position) => {
        void save(true).then(() =>
          api
            .request("/api/location", {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            })
            .then(
              () => load(),
              () => undefined,
            ),
        );
      },
      (problem) =>
        setError(
          problem.code === problem.PERMISSION_DENIED
            ? "Your browser blocked location. Allow it for this site (tap the icon by the web address), then try again."
            : "Couldn’t get your location just now. Try again in a moment.",
        ),
      { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 },
    );
  };
  return (
    <Card style={{ gap: 10 }}>
      <SectionHeading title="Your location" />
      <Text style={s.muted}>
        Shared only while the app is open. Only your latest spot is kept, and it’s forgotten after
        an hour. To name the street, your spot is sent to OpenStreetMap. Weather and local news
        still use your home city.
      </Text>
      <CheckRow
        label="Share where I am while the app is open"
        detail={
          view.enabled
            ? blocked
              ? "Your browser is blocking location. Tap the icon by the web address to allow it."
              : view.sharedAt
                ? `Last shared ${ago(view.sharedAt)}.`
                : "Nothing shared in the last hour. It’s shared while the app is open on your screen."
            : "Off. Your agent doesn’t know where you are."
        }
        checked={view.enabled}
        onPress={() => (busy ? undefined : view.enabled ? void save(false) : turnOn())}
      />
      <Text style={s.small}>You can also say “Where am I?” or “Turn off my location.”</Text>
      <ErrorNotice error={error} />
      <View>
        <Text role="status" style={news ? [s.muted, { color: colors.greenText }] : HIDDEN}>
          {news}
        </Text>
      </View>
    </Card>
  );
}
