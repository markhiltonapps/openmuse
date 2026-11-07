import { Car, Navigation } from "lucide-react-native";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { agoWords, directionsLink, distanceWords } from "../../../packages/domain/src/location";
import { Button, Card, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Where the car is (owner, 2026-11-07): the street, how long ago, the note they gave, and
 * Directions on foot, which opens their maps app and so knows where they are now. "Found it"
 * clears it. A card drawn again from history only clears the parking it shows: a newer spot is
 * never cleared by an old card.
 */
interface Parked {
  lat: number;
  lng: number;
  place?: string;
  note?: string;
  /** Milliseconds since 1970 when they parked. */
  at: number;
  accuracyMeters?: number;
}

const GONE = {
  cleared: "Cleared. Say “I parked here” next time you park.",
  replaced: "You’ve parked somewhere else since, so this one is out of date.",
  none: "Already cleared.",
} as const;

export function ParkedCarToolCard({
  result,
  loading = false,
}: {
  result: unknown;
  loading?: boolean;
}) {
  if (loading) return null;
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  const parked = (value as { parked?: Parked } | null)?.parked;
  if (
    !parked ||
    typeof parked.lat !== "number" ||
    typeof parked.lng !== "number" ||
    typeof parked.at !== "number"
  )
    return null;
  return <ParkedCard parked={parked} />;
}

function ParkedCard({ parked }: { parked: Parked }) {
  const { api } = useWorkspace();
  const [gone, setGone] = useState<keyof typeof GONE>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [undone, setUndone] = useState(false);
  const rough = (parked.accuracyMeters ?? 0) > 150;
  const clear = async () => {
    setBusy(true);
    setProblem("");
    try {
      const answer = await api.request<{ result: keyof typeof GONE }>(
        "/api/location/parked/clear",
        { at: parked.at },
      );
      setGone(answer.result in GONE ? answer.result : "cleared");
    } catch {
      setProblem("Couldn’t clear it. Try again.");
    } finally {
      setBusy(false);
    }
  };
  // Found it clears the spot; Undo puts the same one back (unless they've parked somewhere new).
  const undo = async () => {
    setBusy(true);
    setProblem("");
    try {
      const answer = await api.request<{ restored: boolean }>("/api/location/parked/restore", {
        lat: parked.lat,
        lng: parked.lng,
        place: parked.place,
        note: parked.note,
        at: parked.at,
        accuracy: parked.accuracyMeters,
      });
      if (answer.restored) setGone(undefined);
      else setProblem("Couldn’t put it back: you’ve parked somewhere else since.");
      setUndone(answer.restored);
    } catch {
      setProblem("Couldn’t put it back. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 10, maxWidth: 520 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ marginTop: 1 }}>
          <Car size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.text, { fontWeight: "700" }]}>Your car</Text>
          <Text style={s.text}>{parked.place ?? "Where you left it"}</Text>
          <Text style={s.muted}>{`Parked ${agoWords(Date.now() - parked.at)}`}</Text>
          {!!parked.note && <Text style={[s.text, { marginTop: 4 }]}>{parked.note}</Text>}
        </View>
      </View>
      {rough && (
        <Text style={s.muted}>
          {`Your phone only knew this spot to within ${distanceWords(parked.accuracyMeters ?? 0)}.`}
        </Text>
      )}
      {gone ? (
        <View style={{ gap: 8 }}>
          <Text style={s.muted}>{GONE[gone]}</Text>
          {gone === "cleared" && (
            <View style={{ alignSelf: "flex-start" }}>
              <Button busy={busy} onPress={() => void undo()}>
                Undo
              </Button>
            </View>
          )}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <View style={{ flexBasis: "48%", flexGrow: 1 }}>
            <Button
              primary
              icon={Navigation}
              accessibilityLabel="Directions to your car, on foot"
              onPress={() => void Linking.openURL(directionsLink(parked)).catch(() => undefined)}
            >
              Directions
            </Button>
          </View>
          <View style={{ flexBasis: "48%", flexGrow: 1 }}>
            <Button
              busy={busy}
              accessibilityLabel="Found it: clear this parking spot"
              onPress={() => void clear()}
            >
              Found it
            </Button>
          </View>
        </View>
      )}
      {/* Always mounted, so a change is read out; out of the flow while empty. */}
      <Text
        role="status"
        aria-live="polite"
        pointerEvents="none"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      >
        {gone ? GONE[gone] : undone ? "Put back." : problem}
      </Text>
      {!!problem && <Text style={s.muted}>{problem}</Text>}
    </Card>
  );
}
