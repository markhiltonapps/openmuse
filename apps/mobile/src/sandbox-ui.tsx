import { FileText, SquareTerminal } from "lucide-react-native";
import { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { z } from "zod";
import { BrowserRunContext } from "./browser-tool-card";
import { Button, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

const resultSchema = z.object({
  files: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  notSaved: z.array(z.string()).default([]),
  copiedIn: z.number().default(0),
  error: z.string().optional(),
});
function parsed(result: unknown) {
  let value = result;
  if (typeof result === "string")
    try {
      value = JSON.parse(result);
    } catch {
      return undefined;
    }
  const checked = resultSchema.safeParse(value);
  return checked.success ? checked.data : undefined;
}

/** A run in the code sandbox: working, then the files it made, each a tap from opening. */
export function SandboxCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { api, workspace, refresh, open, notify } = useWorkspace();
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const run = parsed(result);
  const made = run?.files.length ?? 0;
  // Files it saved appear in Files straight away (a run drawn again from history already did).
  const { fresh } = useContext(BrowserRunContext);
  useEffect(() => {
    if (made && fresh) void refresh().catch(() => undefined);
  }, [made, fresh, refresh]);
  if (!loading && !run) return null;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        width: "100%",
        maxWidth: 440,
        gap: 10,
        padding: 14,
        borderRadius: 22,
        backgroundColor: colors.bubble,
      }}
    >
      <View style={[s.row, { gap: 8 }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.blueDark} />
        ) : (
          <SquareTerminal size={16} color={run?.error ? colors.danger : colors.muted} />
        )}
        <Text style={[s.small, { color: colors.mutedStrong, fontWeight: "600" }]}>
          {loading
            ? "Running code…"
            : run?.error
              ? "The code didn’t run"
              : made
                ? `Ran code · saved ${made === 1 ? "1 file" : `${made} files`} to Files`
                : "Ran code"}
        </Text>
      </View>
      {!!made && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {run?.files.map((saved) => {
            const file = workspace.files.find((f) => f.id === saved.id);
            return (
              <Button
                key={saved.id}
                small
                icon={FileText}
                disabled={!file}
                style={{ backgroundColor: colors.card }}
                accessibilityLabel={`Open ${saved.name}`}
                onPress={() => file && open({ type: "file", file })}
              >
                {saved.name}
              </Button>
            );
          })}
        </View>
      )}
      {!!run?.copiedIn && (
        <View style={{ gap: 8 }}>
          <Text style={[s.small, { color: colors.mutedStrong }]}>
            {cleared
              ? "Your sandbox was cleared."
              : `A copy of ${run.copiedIn === 1 ? "your file" : "your files"} stays in your sandbox for up to 30 days, so follow-ups can use ${run.copiedIn === 1 ? "it" : "them"}.`}
          </Text>
          {!cleared && (
            <Button
              small
              busy={clearing}
              style={{ alignSelf: "flex-start", backgroundColor: colors.card }}
              onPress={() => {
                setClearing(true);
                void api
                  .request<{ cleared: boolean }>("/api/sandbox/clear", {})
                  .then(
                    (answer) => {
                      setCleared(true);
                      notify(
                        answer.cleared
                          ? "Cleared your sandbox."
                          : "Your sandbox won’t be used again and expires within 30 days.",
                      );
                    },
                    (e) => notify(e instanceof Error ? e.message : String(e)),
                  )
                  .finally(() => setClearing(false));
              }}
            >
              Clear sandbox
            </Button>
          )}
        </View>
      )}
      {!!run?.notSaved.length && (
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          Couldn’t save to Files: {run.notSaved.join(", ")}
        </Text>
      )}
    </View>
  );
}
