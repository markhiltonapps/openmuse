import { FileText, SquareTerminal } from "lucide-react-native";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { z } from "zod";
import { Button, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

const resultSchema = z.object({
  files: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  notSaved: z.array(z.string()).default([]),
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
  const { workspace, refresh, open } = useWorkspace();
  const run = parsed(result);
  const made = run?.files.length ?? 0;
  // Files it saved appear in Files straight away.
  useEffect(() => {
    if (made) void refresh().catch(() => undefined);
  }, [made, refresh]);
  if (!loading && !run) return null;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        gap: 10,
        padding: 14,
        borderRadius: 18,
        backgroundColor: colors.bubble,
      }}
    >
      <View style={[s.row, { gap: 8 }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.blueDark} />
        ) : (
          <SquareTerminal size={16} color={colors.muted} />
        )}
        <Text style={[s.small, { color: colors.mutedStrong, fontWeight: "600" }]}>
          {loading
            ? "Running code in your sandbox…"
            : run?.error
              ? "The code didn’t run"
              : made
                ? `Ran code · saved ${made === 1 ? "1 file" : `${made} files`} to Files`
                : "Ran code in your sandbox"}
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
                accessibilityLabel={`Open ${saved.name}`}
                onPress={() => file && open({ type: "file", file })}
              >
                {saved.name}
              </Button>
            );
          })}
        </View>
      )}
      {!!run?.notSaved.length && (
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          Not saved (Files can’t hold this type): {run.notSaved.join(", ")}
        </Text>
      )}
    </View>
  );
}
