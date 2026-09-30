import { ChevronRight } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  precipWord,
  type Weather,
  type WeatherAlert,
  type WeatherDay,
  type WeatherHour,
  type WeatherResult,
} from "../../../packages/domain/src/weather";
import { AreaEditor, homeCountry } from "./area-ui";
import { Emoji } from "./emoji";
import { heading } from "./spaces";
import { colors, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The home city's weather at the top of Today on the Feed: now, today's high, low and rain, and
 * any severe-weather alert. A tap opens the next 12 hours and 7 days. From the US National Weather
 * Service, so it's shown for US cities only.
 */

const SHOWN = "openmuse.weather-shown";
/** Whether this device last had a forecast to show, so a loading line only shows for those who get one. */
function lastShown() {
  try {
    return globalThis.localStorage?.getItem(SHOWN) !== "0";
  } catch {
    return true;
  }
}

/** The forecast, fetched when the Feed opens, every 15 minutes, and when the app comes back. */
export function useWeather() {
  const { api } = useWorkspace();
  const [result, setResult] = useState<WeatherResult>();
  /** `fresh` clears what's showing first, for a new city. */
  const load = useCallback(
    (fresh = false) => {
      if (fresh) setResult(undefined);
      return api.request<WeatherResult>("/api/weather").then(
        (next) => {
          // A blip at the Weather Service doesn't take away a forecast that's already showing.
          const blip = "unavailable" in next && next.unavailable === "unreachable";
          setResult((current) => (current && "weather" in current && blip ? current : next));
          if (!blip)
            try {
              globalThis.localStorage?.setItem(SHOWN, "weather" in next ? "1" : "0");
            } catch {
              // Private browsing: the loading line just shows.
            }
        },
        // A failed fetch keeps what's showing; with nothing yet, it says so.
        () => setResult((current) => current ?? { unavailable: "unreachable" }),
      );
    },
    [api],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15 * 60_000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [load]);
  return { result, load };
}

/** "3 PM", in the city's own clock (the time carries its offset). */
const hourOf = (time: string) => {
  const hour = Number(time.slice(11, 13));
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
};
/** The city's date today. */
const todayIn = (timeZone: string) => {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone });
  } catch {
    return new Date().toLocaleDateString("en-CA");
  }
};
/** A time in the city's clock: "2:10 PM". */
const timeIn = (value: string | Date, timeZone: string) => {
  try {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  } catch {
    return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
};
const dayName = (date: string, today: string, style: "short" | "long") =>
  date === today
    ? "Today"
    : new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
        weekday: style,
        timeZone: "UTC",
      });
/** "Until 8 PM", or "Until 8 PM Thursday" when it runs past today. */
function until(ends: string | undefined, timeZone: string) {
  if (!ends) return "";
  try {
    const end = new Date(ends);
    const time = end.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: end.getMinutes() ? "2-digit" : undefined,
      timeZone,
    });
    const sameDay = end.toLocaleDateString("en-CA", { timeZone }) === todayIn(timeZone);
    const day = sameDay
      ? ""
      : ` ${end.toLocaleDateString(undefined, { weekday: "long", timeZone })}`;
    return `Until ${time}${day}`;
  } catch {
    return "";
  }
}
/** "60% chance of rain" (or snow) once it's worth saying. */
const chanceLine = (rain: number | undefined, sky: string) =>
  rain && rain >= 10 ? `${rain}% chance of ${precipWord(sky)}` : "";
const feelsOf = (w: Weather) =>
  Math.abs(w.now.feelsLike - w.now.temp) >= 3 ? w.now.feelsLike : undefined;
/** Feels like, high, low and the chance of rain, as short parts. */
function todayParts(w: Weather) {
  const feels = feelsOf(w);
  return [
    feels !== undefined ? `Feels like ${feels}°` : "",
    w.today.high !== undefined ? `High ${w.today.high}°` : "",
    w.today.low !== undefined ? `Low ${w.today.low}°` : "",
    chanceLine(w.today.rain, w.days[0]?.sky ?? w.now.sky),
  ].filter(Boolean);
}
const severe = (alert: WeatherAlert) => alert.severity === "Extreme" || alert.severity === "Severe";
const moreAlerts = (count: number) =>
  count > 0 ? `${count} more alert${count > 1 ? "s" : ""}` : "";

/** A US-or-unknown device: the only people offered weather before they've saved a city. */
const mayHaveWeather = () => {
  const country = homeCountry();
  return !country || country === "US";
};

/** The rows at the top of Today: an alert when there is one, then the weather. */
export function WeatherToday({
  result,
  reload,
  askingForArea,
  city,
}: {
  result?: WeatherResult;
  /** The saved city, to name when its weather can't be found. */
  city?: string;
  /** Fetches the forecast again; `fresh` for a new city. */
  reload: (fresh?: boolean) => void;
  /** The Feed is already asking where local is (or is still loading), so this doesn't ask too. */
  askingForArea?: boolean;
}) {
  const [opened, setOpened] = useState<"alert" | "weather">();
  const [addingCity, setAddingCity] = useState(false);
  const hasWeather = Boolean(result && "weather" in result);
  // A forecast that goes away closes its sheet, so it doesn't reopen by itself later.
  useEffect(() => {
    if (!hasWeather) setOpened(undefined);
  }, [hasWeather]);
  const citySheet = addingCity && (
    <CitySheet
      onClose={() => setAddingCity(false)}
      onSaved={() => {
        setAddingCity(false);
        reload(true);
      }}
    />
  );
  if (!result)
    return lastShown() ? (
      <Row>
        <Text style={[s.muted, { color: colors.mutedStrong }]}>Checking the weather…</Text>
      </Row>
    ) : null;
  if ("unavailable" in result) {
    if (result.unavailable === "unreachable")
      return (
        <Row>
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            Couldn’t get the weather just now. Trying again in a few minutes.
          </Text>
        </Row>
      );
    const missing = result.unavailable === "not-found";
    if (!missing && (result.unavailable !== "no-area" || askingForArea || !mayHaveWeather()))
      return null;
    return (
      <>
        <PressRow
          label={
            missing
              ? `Couldn’t find the weather for ${city ?? "your city"}. Change city`
              : "Add your city to see the weather"
          }
          onPress={() => setAddingCity(true)}
        >
          {missing ? (
            <Text style={s.text}>
              Couldn’t find the weather for {city ?? "your city"}.{" "}
              <Text style={{ textDecorationLine: "underline" }}>Change city</Text>
            </Text>
          ) : (
            <Text style={[s.text, { textDecorationLine: "underline" }]}>
              Add your city to see the weather
            </Text>
          )}
        </PressRow>
        {citySheet}
      </>
    );
  }
  const w = result.weather;
  const alert = w.alerts[0];
  const parts = todayParts(w);
  // An older forecast standing in says when it's from.
  const old = Date.now() - new Date(w.updatedAt).getTime() > 90 * 60_000;
  const asOf = old ? `As of ${timeIn(w.updatedAt, w.timeZone)}` : "";
  const details = [...parts, asOf].filter(Boolean);
  const feels = feelsOf(w);
  const numbers = [
    w.today.high !== undefined ? `High ${w.today.high} degrees` : "",
    w.today.low !== undefined ? `low ${w.today.low} degrees` : "",
    chanceLine(w.today.rain, w.days[0]?.sky ?? w.now.sky),
    asOf.toLowerCase(),
  ].filter(Boolean);
  const label = [
    `Weather in ${w.place}: ${w.now.temp} degrees, ${w.now.sky.toLowerCase()}${feels !== undefined ? `, feels like ${feels} degrees` : ""}.`,
    numbers.length ? `${numbers.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "",
    "Opens the forecast.",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      {alert && (
        <AlertBand
          alert={alert}
          more={w.alerts.length - 1}
          timeZone={w.timeZone}
          onPress={() => setOpened("alert")}
        />
      )}
      <PressRow label={label} onPress={() => setOpened("weather")}>
        <Text style={s.text} numberOfLines={2}>
          <Text style={{ fontWeight: "700" }}>{w.now.temp}°</Text> {w.now.sky}
        </Text>
        {details.length > 0 && (
          <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
            {details.join(" · ")}
          </Text>
        )}
      </PressRow>
      {opened && (
        <Forecast
          weather={w}
          fromAlert={opened === "alert"}
          onClose={() => setOpened(undefined)}
          onCitySaved={() => {
            setOpened(undefined);
            reload(true);
          }}
        />
      )}
    </>
  );
}

/** Today's row layout: the 🌡️ and its text beside it. */
function Row({ children }: { children: ReactNode }) {
  return (
    <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
      <Emoji char="🌡️" size={36} />
      <View style={{ flex: 1, gap: 3, paddingTop: 6 }}>{children}</View>
    </View>
  );
}

/** A Today row that's one big button, lined up with the rows around it. */
function PressRow({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          gap: 12,
          alignItems: "flex-start",
          padding: 10,
          margin: -10,
          borderRadius: 18,
          backgroundColor: pressed ? colors.subtle : "transparent",
        },
      ]}
    >
      <Emoji char="🌡️" size={36} />
      <View style={{ flex: 1, gap: 3, paddingTop: 6 }}>{children}</View>
      <View style={{ paddingTop: 9 }}>
        <ChevronRight size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

/** The red line at the top of Today; a warning is filled, an advisory tinted. */
function AlertBand({
  alert,
  more,
  timeZone,
  onPress,
}: {
  alert: WeatherAlert;
  more: number;
  timeZone: string;
  onPress: () => void;
}) {
  const strong = severe(alert);
  const ink = strong ? colors.onInverse : colors.danger;
  const line = [until(alert.ends, timeZone), moreAlerts(more)].filter(Boolean).join(" · ");
  return (
    <Pressable
      role="button"
      aria-label={`Weather alert: ${alert.event}${until(alert.ends, timeZone) ? `, ${until(alert.ends, timeZone).replace(/^U/, "u")}` : ""}.${more ? ` ${moreAlerts(more)}.` : ""} Opens the details.`}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          gap: 12,
          padding: 10,
          marginHorizontal: -10,
          borderRadius: 18,
          backgroundColor: strong ? colors.danger : colors.errorBg,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Emoji char="⚠️" size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { color: ink, fontWeight: "700" }]}>{alert.event}</Text>
        {!!line && <Text style={{ fontSize: 13, lineHeight: 18, color: ink }}>{line}</Text>}
      </View>
      <ChevronRight size={18} color={ink} />
    </Pressable>
  );
}

/** Asks where the person lives, for the weather and local news. */
function CitySheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet title="Where do you live?" onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Text style={[s.text, { color: colors.mutedStrong }]}>
          Weather, local news and “near me” searches will be for your city. Weather covers US cities
          only.
        </Text>
        <AreaEditor onSaved={onSaved} onCancel={onClose} />
      </View>
    </Sheet>
  );
}

/** The whole forecast in a sheet: alerts, now, the next 12 hours and 7 days. */
function Forecast({
  weather: w,
  fromAlert,
  onClose,
  onCitySaved,
}: {
  weather: Weather;
  /** Opened from the alert line: the first alert opens in full. */
  fromAlert: boolean;
  onClose: () => void;
  onCitySaved: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const today = todayIn(w.timeZone);
  const parts = todayParts(w);
  return (
    <Sheet
      title={`Weather in ${w.place}`}
      subtitle={`US National Weather Service · updated ${timeIn(w.updatedAt, w.timeZone)}`}
      onClose={onClose}
    >
      <View style={{ gap: 24 }}>
        {w.alerts.map((alert, i) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            timeZone={w.timeZone}
            open={fromAlert && i === 0}
          />
        ))}
        <View style={[s.row, { gap: 16 }]}>
          <Emoji char={w.now.emoji} size={72} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 44,
                lineHeight: 50,
                fontWeight: "700",
                letterSpacing: -1.5,
              }}
            >
              {w.now.temp}°
            </Text>
            <Text style={[s.text, { fontWeight: "600" }]}>{w.now.sky}</Text>
            {parts.length > 0 && (
              <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                {parts.join(" · ")}
              </Text>
            )}
          </View>
        </View>
        {w.hours.length > 0 && <Hours hours={w.hours} />}
        {w.days.length > 0 && <Week days={w.days} today={today} />}
        {changing ? (
          <View style={{ gap: 10 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>Change your city</Text>
            <AreaEditor onSaved={onCitySaved} onCancel={() => setChanging(false)} />
          </View>
        ) : (
          <Pressable
            role="button"
            onPress={() => setChanging(true)}
            style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}
          >
            <Text style={[s.text, { textDecorationLine: "underline" }]}>Change city</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

/** A severe-weather alert: what, until when and what to do; the full text on request. */
function AlertCard({
  alert,
  timeZone,
  open,
}: {
  alert: WeatherAlert;
  timeZone: string;
  open: boolean;
}) {
  const [more, setMore] = useState(open);
  const ends = until(alert.ends, timeZone);
  const strong = severe(alert);
  const ink = strong ? colors.onInverse : colors.danger;
  return (
    <View
      style={{
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: colors.errorBg,
        borderWidth: 1,
        borderColor: colors.danger,
      }}
    >
      <View
        style={[
          s.row,
          {
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: strong ? colors.danger : "transparent",
          },
        ]}
      >
        <Emoji char="⚠️" size={30} />
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { color: ink, fontWeight: "700" }]}>{alert.event}</Text>
          {!!ends && <Text style={{ fontSize: 13, lineHeight: 18, color: ink }}>{ends}</Text>}
        </View>
      </View>
      <View
        style={{ gap: 8, paddingHorizontal: 16, paddingBottom: 12, paddingTop: strong ? 12 : 0 }}
      >
        {!!alert.instruction && <Text style={s.text}>{alert.instruction}</Text>}
        {more && !!alert.description && (
          <Text style={[s.muted, { color: colors.text }]}>{alert.description}</Text>
        )}
        {!!alert.description && (
          <Pressable
            role="button"
            aria-expanded={more}
            onPress={() => setMore((m) => !m)}
            style={{
              alignSelf: "flex-start",
              minHeight: 44,
              marginVertical: -7,
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                lineHeight: 18,
                color: colors.danger,
                fontWeight: "600",
                textDecorationLine: "underline",
              }}
            >
              {more ? "Show less" : "Read the full alert"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Twelve hours: in one row when they fit, else a strip that scrolls to the sheet's edges. */
function Hours({ hours }: { hours: WeatherHour[] }) {
  const [width, setWidth] = useState(0);
  const { width: screen } = useWindowDimensions();
  const edge = screen < 600 ? 20 : 24;
  const fits = width >= hours.length * 56 + (hours.length - 1) * 6;
  const tiles = hours.map((hour, i) => {
    const chance = chanceLine(hour.rain, hour.sky);
    return (
      <View
        key={hour.time}
        role="img"
        accessible
        aria-label={`${i ? hourOf(hour.time) : "Now"}: ${hour.temp} degrees, ${hour.sky.toLowerCase()}${chance ? `, ${chance}` : ""}`}
        style={{
          ...(fits ? { flex: 1, minWidth: 56 } : { width: 64 }),
          alignItems: "center",
          gap: 4,
          paddingVertical: 10,
          borderRadius: 18,
          backgroundColor: i ? colors.subtle : colors.sky,
          ...(i ? {} : { borderWidth: 1.5, borderColor: colors.blueDark }),
        }}
      >
        <Text style={[s.small, { color: colors.mutedStrong, fontWeight: "600" }]}>
          {i ? hourOf(hour.time) : "Now"}
        </Text>
        <Emoji char={hour.emoji} size={30} />
        <Text style={[s.text, { fontWeight: "700" }]}>{hour.temp}°</Text>
        <Text style={{ fontSize: 12, lineHeight: 16, color: colors.blueText, fontWeight: "600" }}>
          {hour.rain && hour.rain >= 10 ? `${hour.rain}%` : " "}
        </Text>
      </View>
    );
  });
  return (
    <View style={{ gap: 10 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text {...heading(3)} style={s.heading}>
        Next 12 hours
      </Text>
      <View role="group" aria-label="Next 12 hours">
        {fits ? (
          <View style={{ flexDirection: "row", gap: 6 }}>{tiles}</View>
        ) : (
          <ScrollView
            horizontal
            // A mouse can't swipe: the web keeps its scrollbar.
            showsHorizontalScrollIndicator={Platform.OS === "web"}
            style={{ marginHorizontal: -edge }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: edge }}
          >
            {tiles}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/** Seven days, each with its low-to-high bar on the week's scale; tap a day for its forecast. */
function Week({ days, today }: { days: WeatherDay[]; today: string }) {
  // Today starts open, which shows that a day opens.
  const [shown, setShown] = useState<string | undefined>(days[0]?.date);
  const temps = days.flatMap((d) => [d.low, d.high]).filter((t): t is number => t !== undefined);
  const [min, max] = [Math.min(...temps), Math.max(...temps)];
  const at = (t: number) => (max > min ? (t - min) / (max - min) : 0.5);
  const numbers = { fontVariant: ["tabular-nums" as const] };
  return (
    <View style={{ gap: 4, maxWidth: 560 }}>
      <Text {...heading(3)} style={[s.heading, { marginBottom: 6 }]}>
        7 days
      </Text>
      {days.map((day, i) => {
        const open = shown === day.date;
        // Late in the evening today has no high left, just tonight's low.
        const tonight = day.date === today && day.high === undefined;
        const name = tonight ? "Tonight" : dayName(day.date, today, "long");
        const chance = chanceLine(day.rain, day.sky);
        return (
          <View key={day.date} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <Pressable
              role="button"
              aria-expanded={open}
              aria-label={`${name}: ${day.sky.toLowerCase()}${day.high !== undefined ? `, high ${day.high} degrees` : ""}${day.low !== undefined ? `, low ${day.low} degrees` : ""}${chance ? `, ${chance}` : ""}`}
              onPress={() => setShown(open ? undefined : day.date)}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 10,
                  minHeight: 52,
                  paddingHorizontal: 8,
                  marginHorizontal: -8,
                  borderRadius: 14,
                  backgroundColor: pressed ? colors.subtle : "transparent",
                },
              ]}
            >
              <Text style={[s.text, { minWidth: 58, fontWeight: "600" }]}>
                {tonight ? "Tonight" : dayName(day.date, today, "short")}
              </Text>
              <Emoji char={day.emoji} size={28} />
              <Text
                style={[
                  numbers,
                  { minWidth: 38, fontSize: 12, fontWeight: "600", color: colors.blueText },
                ]}
              >
                {day.rain && day.rain >= 10 ? `${day.rain}%` : ""}
              </Text>
              <Text
                style={[
                  s.text,
                  numbers,
                  { minWidth: 34, textAlign: "right", color: colors.mutedStrong },
                ]}
              >
                {day.low !== undefined ? `${day.low}°` : ""}
              </Text>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.subtle }}>
                {day.low !== undefined && (
                  <View
                    style={{
                      position: "absolute",
                      left: `${at(day.low) * 100}%`,
                      // Just a low: a dot where it sits.
                      width:
                        day.high !== undefined
                          ? `${Math.max(4, (at(day.high) - at(day.low)) * 100)}%`
                          : 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.blueDark,
                    }}
                  />
                )}
              </View>
              <Text style={[s.text, numbers, { minWidth: 34, fontWeight: "700" }]}>
                {day.high !== undefined ? `${day.high}°` : "–"}
              </Text>
            </Pressable>
            {open && (
              <Text style={[s.muted, { color: colors.text, paddingBottom: 12 }]}>
                {day.detail ?? day.sky}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
