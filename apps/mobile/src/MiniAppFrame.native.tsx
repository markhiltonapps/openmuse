import { Linking } from "react-native";
import { WebView } from "react-native-webview";

/** A mini app on a phone: its page in a web view; links open in the browser, not in the app. */
export default function MiniAppFrame({
  document,
  title,
  height,
}: {
  document: string;
  title: string;
  height: number;
}) {
  return (
    <WebView
      source={{ html: document }}
      accessibilityLabel={title}
      originWhitelist={["about:*"]}
      incognito
      onShouldStartLoadWithRequest={(request) => {
        if (/^about:/.test(request.url)) return true;
        if (/^https?:\/\//.test(request.url)) void Linking.openURL(request.url).catch(() => {});
        return false;
      }}
      style={{ height }}
    />
  );
}
