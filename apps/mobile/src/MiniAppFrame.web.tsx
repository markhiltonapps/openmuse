import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, colors, s } from "./ui";

/**
 * A mini app on the web: its own sandbox with scripts but no access to this app's origin, so it
 * can't read the sign-in or anything else here, and a policy that blocks its network requests. A
 * page can still navigate its own frame; when it does, it's put back, and after a second try it
 * isn't shown again until the person asks. This keeps honest pages tidy; it isn't a defence
 * against a hostile page, which is why mini apps can't hold password boxes (see mini-apps.ts).
 */
export default function MiniAppFrame({
  document,
  title,
  height,
}: {
  document: string;
  title: string;
  height: number;
}) {
  const loads = useRef(0);
  const [round, setRound] = useState(0);
  const [left, setLeft] = useState(0);
  if (left > 2)
    return (
      <View style={{ padding: 16, gap: 10, backgroundColor: colors.errorBg }}>
        <Text role="alert" style={[s.text, { color: colors.text }]}>
          This mini app keeps trying to open a website, so it was stopped. Ask your agent to change
          it.
        </Text>
        <Button
          small
          style={{ alignSelf: "flex-start" }}
          onPress={() => {
            loads.current = 0;
            setLeft(0);
            setRound((n) => n + 1);
          }}
        >
          Show it again
        </Button>
      </View>
    );
  return (
    <View>
      {left > 0 && (
        <View style={{ padding: 10, backgroundColor: colors.errorBg }}>
          <Text role="alert" style={[s.small, { color: colors.text }]}>
            This mini app tried to open a website, so it was reloaded. If it needs that website, ask
            your agent to change it.
          </Text>
        </View>
      )}
      <iframe
        key={round}
        title={title}
        srcDoc={document}
        sandbox="allow-scripts allow-popups allow-modals"
        referrerPolicy="no-referrer"
        onLoad={() => {
          loads.current += 1;
          if (loads.current > 1) {
            loads.current = 0;
            setLeft((n) => n + 1);
            setRound((n) => n + 1);
          }
        }}
        style={{ height, width: "100%", border: 0, background: "#FFF", display: "block" }}
      />
    </View>
  );
}
