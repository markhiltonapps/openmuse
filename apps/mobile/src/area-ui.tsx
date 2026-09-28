import { LocateFixed, MapPin } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Button, colors, ErrorNotice, s } from "./ui";
import { currentPosition, locationAvailable } from "./web-app";
import { useWorkspace } from "./workspace";

/** Topics that are about where the person lives. */
export const LOCAL_TOPIC =
  /\b(local|near me|nearby|my (city|town|area)|weather|traffic|community|neighbou?rhood)\b/i;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The device's country ("US" from en-US), so a typed ZIP code is looked up at home. */
function homeCountry() {
  try {
    const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize();
    return locale.region && /^[A-Z]{2}$/.test(locale.region) ? locale.region : undefined;
  } catch {
    return undefined;
  }
}
const DISMISSED = "openmuse.area-prompt-dismissed";
/** Whether the person said "Not now" to the area prompt on this device. */
export function areaPromptDismissed() {
  try {
    return globalThis.localStorage?.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

/** Sets the person's area from their device's location or a city they type. */
function AreaEditor({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const { api, notify } = useWorkspace();
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState<"locate" | "type">();
  const [error, setError] = useState("");
  async function save(kind: "locate" | "type") {
    setBusy(kind);
    setError("");
    try {
      const body =
        kind === "locate"
          ? await currentPosition()
          : { place: place.trim(), country: homeCountry() };
      const { area } = await api.request<{ area: { label: string } }>("/api/area", body);
      notify(`Local news is now for ${area.label}. Updating your Feed…`);
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  const saveButton = (
    <Button
      small
      busy={busy === "type"}
      disabled={!!busy || place.trim().length < 2}
      onPress={() => void save("type")}
    >
      Save
    </Button>
  );
  return (
    <View style={{ gap: 10 }}>
      {locationAvailable() && (
        <Button
          primary
          small
          icon={LocateFixed}
          busy={busy === "locate"}
          disabled={!!busy}
          style={{ alignSelf: "flex-start" }}
          onPress={() => void save("locate")}
        >
          Use my location
        </Button>
      )}
      <View style={[s.row, { gap: 8 }]}>
        <TextInput
          value={place}
          onChangeText={setPlace}
          onSubmitEditing={() => place.trim().length >= 2 && void save("type")}
          returnKeyType="done"
          placeholder={locationAvailable() ? "Or type a city or ZIP code" : "City or ZIP code"}
          placeholderTextColor={colors.muted}
          accessibilityLabel="Your city or ZIP code"
          autoComplete="postal-address-locality"
          style={[s.input, { flex: 1, minHeight: 42, paddingVertical: 9 }]}
        />
        {!onCancel && saveButton}
      </View>
      {onCancel && (
        <View style={[s.row, { gap: 8 }]}>
          {saveButton}
          <Button small disabled={!!busy} onPress={onCancel}>
            Cancel
          </Button>
        </View>
      )}
      <Text style={[s.small, { color: colors.mutedStrong }]}>
        To find your city, your rough location or what you type is looked up once with
        OpenStreetMap. Only the city is kept.
      </Text>
      <ErrorNotice error={error} />
    </View>
  );
}

/** Asked once, near the top of the Feed, when a followed topic is about where they live. */
export function AreaPrompt({ onSaved, onDismiss }: { onSaved: () => void; onDismiss: () => void }) {
  return (
    <View
      style={{
        gap: 12,
        padding: 18,
        borderRadius: 23,
        backgroundColor: colors.sky,
        borderWidth: 1,
        borderColor: colors.blue,
      }}
    >
      <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
        <MapPin size={19} color={colors.blueDark} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text accessibilityRole="header" style={s.heading}>
            Where’s local for you?
          </Text>
          <Text style={[s.small, { color: colors.mutedStrong }]}>
            Your local news, weather and “near me” searches will be about your area.
          </Text>
        </View>
      </View>
      <AreaEditor onSaved={onSaved} />
      <Button
        small
        style={{ alignSelf: "flex-start", backgroundColor: colors.card }}
        onPress={() => {
          try {
            globalThis.localStorage?.setItem(DISMISSED, "1");
          } catch {
            // Private browsing: it just asks again next time.
          }
          onDismiss();
        }}
      >
        Not now
      </Button>
    </View>
  );
}

/** "Local news is for Houston, Texas", with a way to change it. */
export function AreaRow({ area, onSaved }: { area?: string; onSaved: () => void }) {
  const { api, notify } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  if (editing)
    return (
      <View
        style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}
      >
        <Text style={[s.text, { fontWeight: "600" }]}>
          {area ? "Change your area" : "Where’s local for you?"}
        </Text>
        <AreaEditor
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
          onCancel={() => setEditing(false)}
        />
      </View>
    );
  if (!area)
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setEditing(true)}
        hitSlop={6}
        style={[s.row, { gap: 8, alignSelf: "flex-start", minHeight: 32 }]}
      >
        <MapPin size={15} color={colors.muted} />
        <Text style={[s.text, { textDecorationLine: "underline" }]}>
          Add your area for local news
        </Text>
      </Pressable>
    );
  return (
    <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
      <MapPin size={16} color={colors.muted} style={{ marginTop: 3 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.text}>
          Local news is for <Text style={{ fontWeight: "600" }}>{area}</Text>
        </Text>
        <View style={[s.row, { gap: 16 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change your area from ${area}`}
            onPress={() => setEditing(true)}
            hitSlop={8}
          >
            <Text style={[s.text, { textDecorationLine: "underline" }]}>Change</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove your area"
            onPress={() =>
              void api.request("/api/area/clear", {}).then(
                () => {
                  notify("Removed your area.");
                  onSaved();
                },
                (e) => setError(message(e)),
              )
            }
            hitSlop={8}
          >
            <Text style={[s.text, { color: colors.mutedStrong, textDecorationLine: "underline" }]}>
              Remove
            </Text>
          </Pressable>
        </View>
        <ErrorNotice error={error} />
      </View>
    </View>
  );
}
