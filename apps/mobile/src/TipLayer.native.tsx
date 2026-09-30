import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { hideTip, useTip } from "./tips";
import { colors } from "./ui";

const EDGE = 8;

/**
 * On a phone app, the tip is drawn over the screen, centred on its control: above it, anchored at
 * the bottom so a longer tip grows upwards, or below it near the top of the screen. A tip opened by
 * a tap (an ⓘ) stays until the next touch anywhere, which closes it (a scroll starts with a touch).
 */
export default function TipLayer() {
  const tip = useTip();
  const { width, height } = useWindowDimensions();
  const [size, setSize] = useState(0);
  if (!tip) return null;
  const above = tip.rect.y > 96;
  const widest = Math.min(260, width - EDGE * 2);
  const centre = tip.rect.x + tip.rect.width / 2;
  const left = Math.min(
    Math.max(centre - (size || widest) / 2, EDGE),
    width - (size || widest) - EDGE,
  );
  const bubble = (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left,
        maxWidth: widest,
        ...(above
          ? { bottom: height - tip.rect.y + EDGE }
          : { top: tip.rect.y + tip.rect.height + EDGE }),
      }}
      onLayout={(event) => setSize(event.nativeEvent.layout.width)}
    >
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 8,
          backgroundColor: colors.inverse,
        }}
      >
        <Text style={{ color: colors.onInverse, fontSize: 13, lineHeight: 18, fontWeight: "500" }}>
          {tip.text}
        </Text>
      </View>
    </View>
  );
  if (!tip.sticky) return bubble;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPressIn={hideTip}
        accessibilityRole="button"
        accessibilityLabel="Close tip"
      />
      {bubble}
    </View>
  );
}
