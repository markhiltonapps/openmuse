import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { agoWords, milesWords } from "../../../packages/domain/src/location";
import { isDriving, setDriving } from "./driving";
import { HIDDEN } from "./job-working-ui";
import { Button, Card, CheckRow, colors, ErrorNotice, SectionHeading, s } from "./ui";
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
/** Which device this is, so a laptop left open at home isn't mistaken for the phone in the car. */
const deviceId = () => {
  try {
    const saved = globalThis.localStorage?.getItem("device-id");
    if (saved) return saved;
    const fresh = Math.random().toString(36).slice(2, 12);
    globalThis.localStorage?.setItem("device-id", fresh);
    return fresh;
  } catch {
    return "unknown";
  }
};
const geo = () =>
  Platform.OS === "web" && typeof navigator !== "undefined" ? navigator.geolocation : undefined;
/** About 150 m. */
const moved = (a: GeolocationCoordinates, b: { lat: number; lng: number }) =>
  Math.abs(a.latitude - b.lat) > 0.0014 || Math.abs(a.longitude - b.lng) > 0.0014;

/** Tells Home (and this reporter) when the server thinks the phone is in a car. */
let drivingExpires: ReturnType<typeof setTimeout> | undefined;
function drivingIs(next: boolean) {
  // Each "still driving" answer pushes the end back; with no word for five minutes it clears by itself.
  clearTimeout(drivingExpires);
  if (next) drivingExpires = setTimeout(() => drivingIs(false), 5 * 60_000);
  if (next === isDriving()) return;
  setDriving(next);
  window.dispatchEvent(new Event("driving-changed"));
}

/** Sends the phone's location while the app is open and sharing is on; nothing on screen. */
export function LocationReporter() {
  const { api } = useWorkspace();
  const [on, setOn] = useState(remembered);
  // In a car the phone is asked for a better fix, and more often.
  const [fast, setFast] = useState(isDriving);
  useEffect(() => {
    const listener = () => setFast(isDriving());
    // The flag lives in a plain module; it tells this reporter when it changes.
    window.addEventListener("driving-changed", listener);
    return () => window.removeEventListener("driving-changed", listener);
  }, []);
  const last = useRef<{ lat: number; lng: number; at: number } | undefined>(undefined);
  // The server decides (it can be turned on or off by voice): checked when the app comes back.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const check = () =>
      void api
        .request<{ enabled: boolean; driving?: boolean }>(
          `/api/location?device=${encodeURIComponent(deviceId())}`,
        )
        .then(
          ({ enabled, driving }) => {
            remember(enabled);
            setOn(enabled);
            drivingIs(enabled && driving === true);
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
      // On a motorway the fixes come every few seconds: one every eight is plenty.
      if (prev && Date.now() - prev.at < 8000) return;
      last.current = { lat: c.latitude, lng: c.longitude, at: Date.now() };
      void api
        .request<{ kept: boolean; driving?: boolean }>("/api/location", {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy,
          device: deviceId(),
          // The device's own speed (m/s) and heading, when it has them.
          ...(typeof c.speed === "number" && c.speed >= 0 ? { speed: c.speed } : {}),
          ...(typeof c.heading === "number" && c.heading >= 0 && c.heading <= 360
            ? { heading: c.heading }
            : {}),
        })
        .then(
          (answer) => drivingIs(answer.kept && answer.driving === true),
          () => undefined,
        );
    };
    const start = () => {
      if (watch !== undefined || document.visibilityState !== "visible") return;
      watch = where.watchPosition(send, () => undefined, {
        enableHighAccuracy: fast,
        maximumAge: fast ? 5000 : 60_000,
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
  }, [api, on, fast]);
  return null;
}

interface LocationView {
  enabled: boolean;
  sharedAt: string | null;
  drivingMode?: boolean;
  driving?: boolean;
  mileage?: boolean;
  trips?: {
    count: number;
    monthMeters: number;
    recent: Array<{
      id: string;
      startedAt: number;
      meters: number;
      from?: string;
      to?: string;
      purpose?: string;
    }>;
  };
  parked?: { at: number; place?: string; note?: string } | null;
}

/** "Nov 8", in their calendar. */
const tripDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "3 min ago". */
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
};

/** The switch, on the Account screen. */
export function LocationCard() {
  const { api } = useWorkspace();
  const [view, setView] = useState<LocationView>();
  const [waiting, setWaiting] = useState<Array<{ id: string; text: string; place: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const [news, setNews] = useState("");
  const load = useCallback(
    () =>
      Promise.all([
        api.request<LocationView>("/api/location").then(setView, () => undefined),
        api
          .request<{ reminders: Array<{ id: string; text: string; place: string }> }>(
            "/api/location/place-reminders",
          )
          .then(
            (answer) => setWaiting(answer.reminders),
            () => undefined,
          ),
      ]),
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
      const next = await api.request<LocationView>("/api/location/sharing", { on });
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
  // A parked car is the one thing kept for good: it's shown here, with a way to remove it.
  const removeParked = async () => {
    const at = view.parked?.at;
    if (at === undefined) return;
    setBusy(true);
    setError("");
    try {
      await api.request("/api/location/parked/clear", { at });
      setNews("Parked car removed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // Driving mode and the mileage log are their own switches; what they hold is shown below them.
  const setOption = async (path: "driving" | "mileage", on: boolean) => {
    setBusy(true);
    setError("");
    try {
      setView(await api.request<LocationView>(`/api/location/${path}`, { on }));
      setNews(
        path === "driving"
          ? on
            ? "Driving mode on."
            : "Driving mode off."
          : on
            ? "Mileage log on. It counts drives while the app is open."
            : "Mileage log off. Trips already kept stay until you clear them.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const clearTrips = async () => {
    setConfirmClear(false);
    setBusy(true);
    setError("");
    try {
      await api.request("/api/location/trips/clear", {});
      setNews("Mileage log cleared.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelPlace = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api.request("/api/location/place-reminders/cancel", { id });
      setNews("Reminder removed.");
      await load();
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
        an hour. Two things are kept longer, only if you ask: a parked car, and a mileage log. To
        name the street, your spot is sent to OpenStreetMap. Weather and local news use your home
        city, unless you ask for the weather where you are.
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
      {view.enabled && (
        <CheckRow
          label="Driving mode"
          detail="When your phone is moving at car speed, Home shows a big Talk button and answers stay short. Works only while the app is open, and asks your phone for a precise location (more battery) while you’re moving."
          checked={view.drivingMode !== false}
          onPress={() => (busy ? undefined : void setOption("driving", view.drivingMode === false))}
        />
      )}
      {view.enabled && (
        <CheckRow
          label="Keep a mileage log"
          detail="Counts your drives while the app is open, so it can come up short. It keeps the date, the streets where each drive started and ended, and the miles."
          checked={view.mileage === true}
          onPress={() => (busy ? undefined : void setOption("mileage", view.mileage !== true))}
        />
      )}
      {view.trips && (view.mileage || view.trips.count > 0) && (
        <View
          style={{
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: 12,
            marginTop: 4,
          }}
        >
          <Text style={[s.text, { fontWeight: "600" }]}>
            {view.trips.count
              ? `This month: ${milesWords(view.trips.monthMeters)}`
              : "No drives counted yet"}
          </Text>
          {view.trips.recent.map((trip) => (
            <View key={trip.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 3 }}>
              <Text style={[s.muted, { width: 52 }]}>{tripDay(trip.startedAt)}</Text>
              <Text style={[s.muted, { flex: 1 }]}>
                {`${milesWords(trip.meters)}${trip.to ? ` to ${trip.to}` : ""}${trip.purpose ? ` · ${trip.purpose}` : ""}`}
              </Text>
            </View>
          ))}
          <Text style={s.small}>
            Say “email me my mileage for the month” and the list is written for your OK.
          </Text>
          {view.trips.count > 0 &&
            (confirmClear ? (
              <View style={{ gap: 6 }}>
                <Text role="alert" style={s.muted}>
                  {`Delete all ${view.trips.count} trips? This can’t be undone.`}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Button busy={busy} onPress={() => void clearTrips()}>
                    Yes, delete them
                  </Button>
                  <Button onPress={() => setConfirmClear(false)}>Keep them</Button>
                </View>
              </View>
            ) : (
              <View style={{ alignSelf: "flex-start" }}>
                <Button busy={busy} onPress={() => setConfirmClear(true)}>
                  Clear the log
                </Button>
              </View>
            ))}
        </View>
      )}
      {waiting.length > 0 && (
        <View
          style={{
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: 12,
            marginTop: 4,
          }}
        >
          <Text style={[s.text, { fontWeight: "600" }]}>Waiting for a place</Text>
          {waiting.map((reminder) => (
            <View key={reminder.id} style={{ gap: 4 }}>
              <Text style={s.muted}>{`${reminder.text} · when you get to ${reminder.place}`}</Text>
              <View style={{ alignSelf: "flex-start" }}>
                <Button
                  busy={busy}
                  accessibilityLabel={`Remove reminder: ${reminder.text}`}
                  onPress={() => void cancelPlace(reminder.id)}
                >
                  Remove
                </Button>
              </View>
            </View>
          ))}
          <Text style={s.small}>
            These go off only if the app is open on your screen when you get there.
          </Text>
        </View>
      )}
      {view.parked && (
        <View
          style={{
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: 12,
            marginTop: 4,
          }}
        >
          <Text style={[s.text, { fontWeight: "600" }]}>Parked car saved</Text>
          <Text style={s.muted}>
            {`${view.parked.place ?? "Your car"} · parked ${agoWords(Date.now() - view.parked.at)}. Kept until you remove it or a week passes, even if you turn sharing off.`}
          </Text>
          <View style={{ alignSelf: "flex-start" }}>
            <Button
              busy={busy}
              accessibilityLabel="Remove parked car"
              onPress={() => void removeParked()}
            >
              Remove
            </Button>
          </View>
        </View>
      )}
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
