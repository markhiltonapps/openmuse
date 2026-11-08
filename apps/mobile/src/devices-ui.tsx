import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { agoWords } from "../../../packages/domain/src/location";
import { HIDDEN } from "./job-working-ui";
import { Button, Card, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Small Neddy devices (a watch-style board you hold a button on to talk). A device with no
 * keyboard shows a six-digit code; typing it here pairs it to this account. Each can be renamed,
 * and removing one turns it off for good. Early testing: shown for the admin and for anyone who
 * has a device; everyone else pairs by saying it.
 */
interface DeviceView {
  id: string;
  name: string;
  model: string;
  createdAt: string;
  lastSeenAt?: string;
  firmware?: string;
  connected: boolean;
}
interface DevicesView {
  talkReady: boolean;
  visible: boolean;
  devices: DeviceView[];
}

const seenWords = (device: DeviceView) =>
  device.connected
    ? "Connected now"
    : device.lastSeenAt
      ? `Last connected ${agoWords(Date.now() - Date.parse(device.lastSeenAt))}`
      : "Hasn’t connected yet";
/** "482913" shown as "482 913". */
const grouped = (digits: string) =>
  digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;

export function DevicesCard() {
  const { api } = useWorkspace();
  const [view, setView] = useState<DevicesView>();
  // Once shown, it stays: removing your last device must not take its own confirmation with it.
  const [seen, setSeen] = useState(false);
  const [digits, setDigits] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [news, setNews] = useState("");
  const [removing, setRemoving] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const inFlight = useRef(false);
  const load = useCallback(
    () => api.request<DevicesView>("/api/devices").then(setView, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
    // A device that was just paired connects soon after; keep the list fresh.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (view?.visible) setSeen(true);
  }, [view?.visible]);
  if (!view || !(view.visible || seen)) return null;
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNews("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Couldn’t do that just now. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const ready = digits.length === 6;
  const pair = () =>
    ready
      ? run(async () => {
          const made = await api.request<DeviceView>("/api/devices/pair", {
            code: digits,
            ...(name.trim() ? { name: name.trim() } : {}),
          });
          setDigits("");
          setName("");
          setNews(
            view.talkReady
              ? `Paired as “${made.name}”. The device should let you know it’s ready in a little while. Hold its button to talk.`
              : `Paired as “${made.name}”, but talking with devices isn’t switched on yet, so it can’t answer for now. Ask whoever looks after Neddy to turn it on.`,
          );
          await load();
        })
      : undefined;
  const rename = () =>
    run(async () => {
      if (!renaming?.name.trim()) return;
      await api.request(`/api/devices/${renaming.id}/rename`, { name: renaming.name.trim() });
      setNews("Renamed.");
      setRenaming(undefined);
      await load();
    });
  const remove = (device: DeviceView) =>
    run(async () => {
      await api.request(`/api/devices/${device.id}/remove`, {});
      setRemoving("");
      setNews(`“${device.name}” is removed. To use it again, pair it again.`);
      await load();
    });
  return (
    <Card style={{ gap: 10 }}>
      <SectionHeading title="Your devices" />
      <Text style={s.muted}>
        Pair a small Neddy device and hold its button to talk. It uses your call minutes, like a
        call from your phone. Early testing: the device software isn’t released yet, so this is for
        people helping us try it.
      </Text>
      {!view.talkReady && (
        <Text style={[s.muted, { color: colors.danger, fontWeight: "600" }]}>
          Talking with devices isn’t switched on yet, so a paired device can’t answer for now. Ask
          whoever looks after Neddy to turn on Neddy’s own voice.
        </Text>
      )}
      {view.devices.map((device) => (
        <View
          key={device.id}
          style={{
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: 12,
            marginTop: 4,
          }}
        >
          {renaming?.id !== device.id && (
            <Text style={[s.text, { fontWeight: "600" }]}>{device.name}</Text>
          )}
          <Text style={[s.muted, device.connected ? { color: colors.greenText } : undefined]}>
            {seenWords(device)}
          </Text>
          {(device.model || device.firmware) && (
            <Text style={s.small}>
              {[device.model, device.firmware ? `software ${device.firmware}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
          {renaming?.id === device.id ? (
            <View style={{ gap: 8 }}>
              <Field
                label="Device name"
                value={renaming.name}
                maxLength={40}
                onChangeText={(text) => setRenaming({ id: device.id, name: text })}
                onSubmitEditing={() => void rename()}
              />
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button busy={busy} disabled={!renaming.name.trim()} onPress={() => void rename()}>
                  Save name
                </Button>
                <Button onPress={() => setRenaming(undefined)}>Cancel</Button>
              </View>
            </View>
          ) : removing === device.id ? (
            <View style={{ gap: 6 }}>
              <Text role="alert" style={s.muted}>
                {`Remove “${device.name}” for good? It stops working at once and has to be paired again.`}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button busy={busy} danger onPress={() => void remove(device)}>
                  Yes, remove it
                </Button>
                <Button onPress={() => setRemoving("")}>Keep it</Button>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                accessibilityLabel={`Rename ${device.name}`}
                onPress={() => setRenaming({ id: device.id, name: device.name })}
              >
                Rename
              </Button>
              <Button
                accessibilityLabel={`Remove ${device.name}`}
                onPress={() => setRemoving(device.id)}
              >
                Remove
              </Button>
            </View>
          )}
        </View>
      ))}
      <View
        style={{
          gap: 8,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingTop: 12,
          marginTop: 4,
        }}
      >
        <Text style={[s.text, { fontWeight: "600" }]}>Pair a device</Text>
        <Text style={s.muted}>
          Turn the device on and connect it to Wi-Fi. It shows a six-digit code for ten minutes;
          type it here, or say “pair my device” and read out the digits.
        </Text>
        <Field
          label="Code on the device"
          value={grouped(digits)}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={14}
          placeholder="482 913"
          onChangeText={(text) => {
            setDigits(text.replace(/\D/g, "").slice(0, 6));
            setError("");
          }}
          onSubmitEditing={() => void pair()}
        />
        <Field
          label="Name it (optional, “My device” if you skip this)"
          value={name}
          maxLength={40}
          placeholder="Desk"
          onChangeText={setName}
          onSubmitEditing={() => void pair()}
        />
        <View style={{ alignSelf: "flex-start" }}>
          <Button busy={busy} primary disabled={!ready} onPress={() => void pair()}>
            Pair device
          </Button>
        </View>
        {digits.length > 0 && !ready && (
          <Text style={s.muted}>A code is six digits. Keep typing.</Text>
        )}
      </View>
      <ErrorNotice error={error} />
      <View>
        <Text role="status" style={news ? [s.muted, { color: colors.greenText }] : HIDDEN}>
          {news}
        </Text>
      </View>
    </Card>
  );
}
