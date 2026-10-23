import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { PERSONA_FACTS, type PersonaFact } from "../../../packages/domain/src/persona";
import type { MuseApi } from "./api";
import { lookedAt } from "./receipt-text";
import { Button, Card, colors, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

export interface ReceiptInfo {
  /** The places this answer looked, in words (see receipt-text.ts). */
  used: string[];
  /** What was kept from the AI, in words ("a card number"); empty when nothing was. */
  hidden: string;
  hiddenCount: number;
  /** The server's note for this answer has arrived: without it, "nothing hidden" isn't known. */
  known: boolean;
}

/** What the server kept for each question of a chat, by the message that asked it. */
export type TurnReceipts = Record<string, { at: string; hidden: string; hiddenCount: number }>;

/**
 * A chat's receipts: loaded when it opens and again a moment after each answer ends (the server
 * writes them as the answer finishes). Failing quietly is fine: the button then shows what it can.
 */
export function useReceipts(api: MuseApi, threadId: string, on: boolean, replying: boolean) {
  const [turns, setTurns] = useState<TurnReceipts>({});
  const wasReplying = useRef(false);
  const load = useCallback(() => {
    api.request<{ turns: TurnReceipts }>(`/api/receipts/${encodeURIComponent(threadId)}`).then(
      (result) => setTurns(result.turns),
      () => undefined,
    );
  }, [api, threadId]);
  useEffect(() => {
    setTurns({});
    if (on) load();
  }, [on, load]);
  useEffect(() => {
    const ended = wasReplying.current && !replying;
    wasReplying.current = replying;
    if (!ended || !on) return;
    const timer = setTimeout(load, 1500);
    return () => clearTimeout(timer);
  }, [replying, on, load]);
  return turns;
}

/** "What I used" under an answer: where it looked, what it kept out, and what it knows about you. */
export function ReceiptSheet({ info }: { info: ReceiptInfo }) {
  const { api, close } = useWorkspace();
  const [facts, setFacts] = useState<PersonaFact[]>();
  // Forgotten here, kept in place so the next Forget button doesn't move under a thumb.
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const loaded = (await api.request<{ facts: PersonaFact[] }>("/api/persona")).facts;
      setFacts((current) => {
        if (!current) return loaded;
        // Back in the order shown, with anything new at the end.
        const keys = current.map((fact) => fact.key);
        return [
          ...current.map((fact) => loaded.find((item) => item.key === fact.key) ?? fact),
          ...loaded.filter((fact) => !keys.includes(fact.key)),
        ];
      });
    } catch {
      setError("Couldn’t load your About you page.");
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  async function forget(fact: PersonaFact) {
    setError("");
    try {
      await api.request(`/api/persona/${encodeURIComponent(fact.key)}/forget`, {});
      setGone((current) => [...current, fact.key]);
    } catch {
      setError(`Couldn’t forget “${PERSONA_FACTS[fact.key].label}”. Try again.`);
    }
  }
  async function undo(fact: PersonaFact) {
    setError("");
    try {
      await api.request(`/api/persona/${encodeURIComponent(fact.key)}/restore`, {
        value: fact.value,
        source: fact.source,
        confidence: fact.confidence,
        createdAt: fact.createdAt,
      });
      setGone((current) => current.filter((key) => key !== fact.key));
    } catch {
      setError(`Couldn’t put “${PERSONA_FACTS[fact.key].label}” back. Try again.`);
    }
  }
  return (
    <Sheet title="What I used" subtitle="For this answer" onClose={close} fill>
      <View style={{ gap: 20, padding: 4 }}>
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Where I looked</Text>
          {info.used.length ? (
            info.used.map((place) => (
              <Text key={place} style={s.text}>
                {place}
              </Text>
            ))
          ) : (
            <Text style={s.text}>
              Nothing I can list. I answered from our chat and what I already know about you.
            </Text>
          )}
          <Text style={s.muted}>This lists the main places I can look.</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Kept out of view</Text>
          <Text style={s.text}>
            {!info.known
              ? "Not available for this answer."
              : info.hiddenCount
                ? `I never saw ${info.hidden}. It was hidden before I read it.`
                : "I have no note of anything being hidden."}
          </Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>On your About you page</Text>
          <Text style={s.muted}>
            I can use these in any answer, so I can’t say which ones this answer leaned on. Forget
            any you don’t want me to have. You can undo until you close this.
          </Text>
          {/* Kept mounted so a message is read out when it appears, and out of the flow while empty. */}
          <Text
            role="status"
            style={[
              s.muted,
              { color: colors.danger },
              !error && {
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
              },
            ]}
          >
            {error}
          </Text>
          {facts === undefined && !error ? <Text style={s.muted}>Loading…</Text> : null}
          {facts === undefined && error ? (
            <Button small onPress={() => void load()} style={{ alignSelf: "flex-start" }}>
              Try again
            </Button>
          ) : null}
          {facts?.length === 0 ? <Text style={s.muted}>Nothing yet.</Text> : null}
          {facts?.length ? (
            <Card style={{ backgroundColor: colors.subtle, paddingVertical: 6 }}>
              {facts.map((fact) =>
                gone.includes(fact.key) ? (
                  <FactLine
                    key={fact.key}
                    label={PERSONA_FACTS[fact.key].label}
                    value="Forgotten"
                    faded
                    action="Undo"
                    onPress={() => void undo(fact)}
                  />
                ) : (
                  <FactLine
                    key={fact.key}
                    label={PERSONA_FACTS[fact.key].label}
                    value={fact.value}
                    action="Forget"
                    onPress={() => void forget(fact)}
                  />
                ),
              )}
            </Card>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}

function FactLine({
  label,
  value,
  action,
  faded,
  onPress,
}: {
  label: string;
  value: string;
  action: string;
  faded?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={[s.row, { gap: 12, minHeight: 56 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.small}>{label}</Text>
        <Text style={faded ? s.muted : s.text}>{value}</Text>
      </View>
      <Button
        small
        onPress={onPress}
        accessibilityLabel={`${action} ${label}`}
        style={{ minHeight: 44, paddingVertical: 10, backgroundColor: colors.card }}
      >
        {action}
      </Button>
    </View>
  );
}

export { lookedAt };
