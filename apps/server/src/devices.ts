import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * A small device the person talks to by holding a button (the watch-style board on a desk or a
 * wrist). It has no keyboard, so it shows a six-digit code and the person types that code into
 * the app; the device then collects its own long token once, and uses it (never the person's
 * sign-in) for everything after. Only a hash of a token is kept, so a copy of the database
 * can't speak as a device, and one tap in the app turns a device off for good.
 */
/** What a device's idle screen (clock, weather, next meeting) does; the person changes these by voice or chat. */
export interface DeviceSettings {
  /** Seconds of quiet before the idle screen shows; 0 = never. */
  idleAfter: number;
  /** Dim the screen after a minute of idle. */
  dim: boolean;
  showWeather: boolean;
  showMeeting: boolean;
  /** A small battery level on the idle screen (when the device has a battery). */
  showBattery: boolean;
  /** How smoothly Neddy moves on the watch: saver (about 8 frames a second), normal (16) or smooth (up to 30). */
  animation: "saver" | "normal" | "smooth";
  /** What the home screen looks like: info (clock, weather, next meeting), analog (a dial with hands) or neon (big glowing digits). */
  face: "info" | "analog" | "neon";
  /** Raising the wrist brightens a screen that has dimmed (the watch reads its motion chip only while this is on). Off until the person asks for it. */
  raiseToWake: boolean;
}
export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  idleAfter: 10,
  dim: true,
  showWeather: true,
  showMeeting: true,
  showBattery: true,
  animation: "normal",
  face: "info",
  raiseToWake: false,
};
export const settingsOf = (device: Pick<Device, "settings">): DeviceSettings => ({
  ...DEFAULT_DEVICE_SETTINGS,
  ...(device.settings ?? {}),
});

export interface Device {
  id: string;
  name: string;
  /** What it said it is ("Waveshare ESP32-S3 AMOLED 2.06"), for the person's list. */
  model: string;
  createdAt: string;
  lastSeenAt?: string;
  /** The firmware it last said it runs. */
  firmware?: string;
  settings?: Partial<DeviceSettings>;
}

/** A code on a device's screen, waiting for the person to type it in the app. */
interface Pairing {
  id: string;
  code: string;
  /** Hash of what the device polls with. */
  pollHash: string;
  model: string;
  expiresAt: string;
  /** Set when the person has entered the code. */
  claimed?: { owner: string; deviceId: string };
}
interface TokenRecord {
  id: string;
  owner: string;
  deviceId: string;
}

const PAIR_MINUTES = 10;
/** Most devices one person can have at once. */
export const MAX_DEVICES = 5;
const MAX_PENDING = 100;
const START_PER_HOUR = 12;
const WRONG_CODES = 8;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const TOKEN_PATTERN = /^dev_[\w-]{40,64}$/;

export const pairClaimSchema = z.object({
  // Said out loud the digits come one at a time ("4 8 2 9 1 3"): spaces and dashes are dropped.
  code: z
    .string()
    .trim()
    .transform((code) => code.replace(/[\s-]/g, ""))
    .refine((code) => /^\d{6}$/.test(code), "A code is six digits, like 482 913."),
  name: z.string().trim().min(1).max(40).optional(),
});

export class Devices {
  /** Calls to start a pairing per address, and wrong codes per person, in the last while. */
  private readonly starts = new Map<string, number[]>();
  private readonly wrong = new Map<string, number[]>();
  private readonly seen = new Map<string, number>();
  private readonly removedHooks: ((deviceId: string) => void)[] = [];
  private readonly settingsHooks: ((deviceId: string) => void)[] = [];
  constructor(
    private readonly db: Store,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(map: Map<string, number[]>, key: string, windowMs: number) {
    const cutoff = this.now() - windowMs;
    const kept = (map.get(key) ?? []).filter((at) => at > cutoff);
    map.set(key, kept);
    return kept;
  }

  /** A device asks to be paired: a code to show, and a secret to ask about it with. */
  async start(model: string, from = "unknown") {
    const tries = this.recent(this.starts, from, 3_600_000);
    if (tries.length >= START_PER_HOUR)
      throw new AppError(
        "Too many codes were asked for just now. Wait a little and try again.",
        429,
      );
    tries.push(this.now());
    // Old codes fall away; the table stays small however often a device asks.
    const all = await this.db.list<Pairing>("system", "device-pairs");
    const live: Pairing[] = [];
    for (const pairing of all) {
      if (Date.parse(pairing.expiresAt) <= this.now())
        await this.db.remove("system", "device-pairs", pairing.id);
      else live.push(pairing);
    }
    if (live.length >= MAX_PENDING)
      throw new AppError("Lots of devices are pairing right now. Try again in a few minutes.", 503);
    const taken = new Set(live.map((pairing) => pairing.code));
    let code = "";
    do code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    while (taken.has(code));
    const pollToken = randomBytes(24).toString("base64url");
    const expiresAt = new Date(this.now() + PAIR_MINUTES * 60_000).toISOString();
    await this.db.put("system", "device-pairs", {
      id: randomUUID(),
      code,
      pollHash: hash(pollToken),
      model: model.slice(0, 60),
      expiresAt,
    } satisfies Pairing);
    return { code, pollToken, expiresAt, expiresInSeconds: PAIR_MINUTES * 60 };
  }

  /** The person typed the code shown on the device. */
  async claim(owner: string, input: z.infer<typeof pairClaimSchema>) {
    const pairing = (await this.db.list<Pairing>("system", "device-pairs")).find(
      (entry) => entry.code === input.code,
    );
    // The same person saying it twice (a double tap, the agent repeating the call) gets the same
    // device back, and it doesn't count as a wrong code.
    if (pairing?.claimed?.owner === owner) {
      const same = await this.db.get<Device>(owner, "devices", pairing.claimed.deviceId);
      if (same) return same;
    }
    const misses = this.recent(this.wrong, owner, PAIR_MINUTES * 60_000);
    if (misses.length >= WRONG_CODES)
      throw new AppError(
        "That hasn’t matched a few times in a row, so let’s pause for about ten minutes. Check the number on the device’s screen, then try again.",
        429,
      );
    const owned = await this.db.list<Device>(owner, "devices");
    if (owned.length >= MAX_DEVICES)
      throw new AppError(
        `You can pair up to ${MAX_DEVICES} devices. Remove one you don’t use first.`,
        409,
      );
    if (!pairing || Date.parse(pairing.expiresAt) <= this.now() || pairing.claimed) {
      misses.push(this.now());
      throw new AppError(
        "That code isn’t right, or it has run out (they last ten minutes). Check the number on the device’s screen, and if it has changed, use the new one.",
        404,
      );
    }
    // Two devices never share a name, so “remove the kitchen one” can be told apart.
    const taken = new Set(owned.map((device) => device.name.toLowerCase()));
    const wanted = input.name ?? "My device";
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} ${n}`;
    const device: Device = {
      id: randomUUID(),
      name,
      model: pairing.model,
      createdAt: new Date(this.now()).toISOString(),
    };
    await this.db.put(owner, "devices", device);
    await this.db.put("system", "device-pairs", {
      ...pairing,
      claimed: { owner, deviceId: device.id },
    });
    return device;
  }

  /**
   * The device asks whether its code was entered. Once it was, it's given a token, one time
   * only (a new one is made at that moment, so no token waits in the database).
   */
  async poll(pollToken: string) {
    if (!/^[\w-]{20,64}$/.test(pollToken))
      throw new AppError("That pairing isn’t known any more. Ask the device for a new code.", 404);
    const pairing = (await this.db.list<Pairing>("system", "device-pairs")).find(
      (entry) => entry.pollHash === hash(pollToken),
    );
    if (!pairing) return { status: "expired" as const };
    if (Date.parse(pairing.expiresAt) <= this.now() && !pairing.claimed) {
      await this.db.remove("system", "device-pairs", pairing.id);
      return { status: "expired" as const };
    }
    if (!pairing.claimed) return { status: "waiting" as const };
    const { owner, deviceId } = pairing.claimed;
    await this.db.remove("system", "device-pairs", pairing.id);
    const device = await this.db.get<Device>(owner, "devices", deviceId);
    // Removed in the app between the code and this: nothing to hand out.
    if (!device) return { status: "expired" as const };
    const token = `dev_${randomBytes(33).toString("base64url")}`;
    await this.db.put("system", "device-tokens", {
      id: hash(token),
      owner,
      deviceId,
    } satisfies TokenRecord);
    return { status: "paired" as const, token, name: device.name };
  }

  /** Who a device token belongs to, or nothing. */
  async authenticate(token: string | undefined) {
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const found = await this.db.get<TokenRecord>("system", "device-tokens", hash(token));
    if (!found) return null;
    const device = await this.db.get<Device>(found.owner, "devices", found.deviceId);
    return device ? { owner: found.owner, device } : null;
  }

  /** Notes that a device connected (once a minute at most), and what firmware it runs. */
  async touch(owner: string, device: Device, firmware?: string) {
    const last = this.seen.get(device.id) ?? 0;
    if (this.now() - last < 60_000 && !firmware) return;
    this.seen.set(device.id, this.now());
    await this.db.put(owner, "devices", {
      ...device,
      lastSeenAt: new Date(this.now()).toISOString(),
      ...(firmware ? { firmware: firmware.slice(0, 40) } : {}),
    });
  }

  /** Told when a device is removed, so its open connection can be closed. */
  onRemoved(hook: (deviceId: string) => void) {
    this.removedHooks.push(hook);
  }

  /** Told when a device's settings change, so it can be sent the new ones at once. */
  onSettingsChanged(hook: (deviceId: string) => void) {
    this.settingsHooks.push(hook);
  }

  list(owner: string) {
    return this.db.list<Device>(owner, "devices");
  }

  get(owner: string, id: string) {
    return this.db.get<Device>(owner, "devices", id);
  }

  /** Changes some of a device's idle-screen settings (the rest stay as they were). */
  async setSettings(owner: string, id: string, patch: Partial<DeviceSettings>) {
    const device = await this.db.get<Device>(owner, "devices", id);
    if (!device) throw new AppError("That device isn’t on your list.", 404);
    const next = { ...settingsOf(device), ...patch };
    next.idleAfter = Math.max(0, Math.min(600, Math.round(next.idleAfter)));
    await this.db.put(owner, "devices", { ...device, settings: next });
    for (const hook of this.settingsHooks) hook(id);
    return next;
  }

  async rename(owner: string, id: string, name: string) {
    const device = await this.db.get<Device>(owner, "devices", id);
    if (!device) throw new AppError("That device isn’t on your list.", 404);
    return this.db.put(owner, "devices", { ...device, name: name.trim().slice(0, 40) });
  }

  /** Turns a device off for good: its tokens stop working at once. */
  async remove(owner: string, id: string) {
    const device = await this.db.get<Device>(owner, "devices", id);
    if (!device) throw new AppError("That device isn’t on your list.", 404);
    for (const { value } of await this.db.scan<TokenRecord>("device-tokens"))
      if (value.deviceId === id && value.owner === owner)
        await this.db.remove("system", "device-tokens", value.id);
    await this.db.remove(owner, "devices", id);
    this.seen.delete(id);
    for (const hook of this.removedHooks) hook(id);
    return { ok: true as const, id };
  }
}

/** The idle-screen settings in plain words, for the agent to say. */
export function describeSettings(settings: DeviceSettings) {
  const shows = [
    "the clock",
    ...(settings.showWeather ? ["the weather"] : []),
    ...(settings.showMeeting ? ["the next meeting"] : []),
    ...(settings.showBattery ? ["the battery level"] : []),
  ];
  const raise = settings.raiseToWake
    ? settings.dim
      ? "raise to wake is on (raising the wrist brightens the screen once it has dimmed)"
      : "raise to wake is on, but the screen never dims, so there's nothing for it to brighten until dimming is on"
    : "raise to wake is off";
  return settings.idleAfter === 0
    ? `the idle screen is off; ${raise}`
    : `after ${settings.idleAfter} seconds of quiet it shows ${shows.join(", ")}, and ${settings.dim ? "dims after a minute" : "stays bright"}; Neddy's animation is ${settings.animation}; the watch face is ${settings.face}; ${raise}`;
}

/** The chat's one tool for devices: pair one with the code on its screen, list, rename or remove. */
export function deviceToolSpecs(
  devices: Devices,
  owner: string,
  options: { talkReady?: boolean } = {},
) {
  /** Which device a spoken request means: its name, or any of its words, or "the first / second / last one". */
  const pick = (list: Device[], wanted?: string) => {
    const said = (wanted ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    // People call it "my watch", "the wearable", "the screen": those words only name the kind of
    // thing, unless one of their devices is really called that.
    const kind = ["watch", "wearable", "board", "gadget", "screen", "neddy", "little", "small"];
    const words = said
      .split(/\s+/)
      .filter(
        (word) =>
          word &&
          !["my", "the", "device", "one"].includes(word) &&
          !(
            kind.includes(word) && !list.some((device) => device.name.toLowerCase().includes(word))
          ),
      );
    if (!words.length) return list.length === 1 ? list[0] : undefined;
    const ordinal = { first: 0, second: 1, third: 2, last: list.length - 1 } as Record<
      string,
      number
    >;
    for (const word of words)
      if (word in ordinal && !list.some((device) => device.name.toLowerCase().includes(word)))
        return list[ordinal[word] as number];
    const exact = list.filter((device) => device.name.toLowerCase() === said.trim());
    if (exact.length === 1) return exact[0];
    const matches = list.filter((device) => {
      const name = device.name.toLowerCase();
      return words.every((word) => name.includes(word));
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  return [
    {
      name: "manage_devices",
      description:
        "The person's Neddy watch or watches (also called a device, wearable or gadget: a small watch-style board with a screen they hold a button on to talk). When they say “my watch”, “the watch screen”, “the idle screen” or “turn the screen down”, this is the tool, and with one watch you need no name. Actions (do): 'pair' adds one, using the six-digit code on the device's screen (say “code”, not “PIN”) and an optional name; 'list' shows them and their idle-screen settings; 'rename' needs name (which one) and new_name; 'settings' changes the idle screen (its home screen: the clock, weather, next meeting and battery level it shows after a quiet spell, 10 seconds by default, and again after every answer): idle_after_seconds (0 turns the idle screen off), dim (dim the screen after a minute of quiet; there is no brightness level to set, so for “turn the screen down” use dim and say so), show_weather, show_meeting, show_battery, animation (how smoothly Neddy moves: saver, normal or smooth), face (the watch face: info, analog or neon), raise_to_wake (raising their wrist brightens the screen once it has dimmed, like a normal watch; it needs dim on, it is off until they ask for it, and it uses a little battery), for the device named in name; 'remove' needs name and turns one off for good: first say which device you mean and ask them to confirm, then call again with confirm true. Nothing is drawn on their screen by this.",
      parameters: z.object({
        do: z.enum(["pair", "list", "rename", "remove", "settings"]),
        code: z.string().max(20).optional().describe("The six digits on the device's screen"),
        name: z.string().max(40).optional().describe("The device's name, or how they described it"),
        new_name: z.string().max(40).optional(),
        confirm: z.boolean().optional().describe("True only after they said yes to removing it"),
        idle_after_seconds: z
          .number()
          .int()
          .min(0)
          .max(600)
          .optional()
          .describe("settings: seconds of quiet before the idle screen shows; 0 = never"),
        dim: z.boolean().optional().describe("settings: dim the idle screen after a minute"),
        show_weather: z.boolean().optional().describe("settings: weather on the idle screen"),
        show_meeting: z.boolean().optional().describe("settings: next meeting on the idle screen"),
        show_battery: z
          .boolean()
          .optional()
          .describe("settings: the small battery level on the idle screen"),
        face: z
          .enum(["info", "analog", "neon"])
          .optional()
          .describe(
            "settings: the watch face: info (clock, weather, next meeting), analog (a dial with hands) or neon (big glowing digits)",
          ),
        raise_to_wake: z
          .boolean()
          .optional()
          .describe(
            "settings: raising the wrist brightens the screen once it has dimmed (needs dim on; off until they ask)",
          ),
        animation: z
          .enum(["saver", "normal", "smooth"])
          .optional()
          .describe(
            "settings: how smoothly Neddy moves on the watch: saver (saves battery), normal, smooth (the most frames; uses more battery)",
          ),
      }),
      execute: async (input: {
        do: "pair" | "list" | "rename" | "remove" | "settings";
        idle_after_seconds?: number;
        dim?: boolean;
        show_weather?: boolean;
        show_meeting?: boolean;
        show_battery?: boolean;
        raise_to_wake?: boolean;
        animation?: "saver" | "normal" | "smooth";
        face?: "info" | "analog" | "neon";
        code?: string;
        name?: string;
        new_name?: string;
        confirm?: boolean;
      }) => {
        const list = await devices.list(owner);
        try {
          if (input.do === "list")
            return {
              devices: list.map((device) => ({
                name: device.name,
                model: device.model,
                lastSeenAt: device.lastSeenAt ?? null,
                idleScreen: describeSettings(settingsOf(device)),
              })),
              message: list.length
                ? `They have ${list.length} device${list.length === 1 ? "" : "s"}.`
                : "They have no devices yet. To add one, the device shows a six-digit code and they say the digits here.",
            };
          if (input.do === "pair") {
            const parsed = pairClaimSchema.safeParse({
              code: input.code ?? "",
              ...(input.name ? { name: input.name } : {}),
            });
            if (!parsed.success)
              return { error: "I need the six digits shown on the device’s screen." };
            const device = await devices.claim(owner, parsed.data);
            return {
              paired: true,
              name: device.name,
              message:
                options.talkReady === false
                  ? `Paired as “${device.name}”, but talking with devices isn’t switched on yet, so it can’t answer for now. Tell them to ask whoever looks after Neddy to turn it on.`
                  : `Paired as “${device.name}”. The device should let them know it’s ready within a little while. They hold its button to talk. It uses call minutes, like a phone call.`,
            };
          }
          const device = pick(list, input.name);
          if (!device)
            return {
              error: list.length
                ? `Which device? They have: ${list.map((item) => item.name).join(", ")}.`
                : "They have no devices.",
            };
          if (input.do === "settings") {
            const patch: Partial<DeviceSettings> = {
              ...(input.idle_after_seconds !== undefined
                ? { idleAfter: input.idle_after_seconds }
                : {}),
              ...(input.dim !== undefined ? { dim: input.dim } : {}),
              ...(input.show_weather !== undefined ? { showWeather: input.show_weather } : {}),
              ...(input.show_meeting !== undefined ? { showMeeting: input.show_meeting } : {}),
              ...(input.show_battery !== undefined ? { showBattery: input.show_battery } : {}),
              ...(input.animation !== undefined ? { animation: input.animation } : {}),
              ...(input.face !== undefined ? { face: input.face } : {}),
              ...(input.raise_to_wake !== undefined ? { raiseToWake: input.raise_to_wake } : {}),
            };
            if (!Object.keys(patch).length)
              return {
                settings: describeSettings(settingsOf(device)),
                message: `${device.name}'s idle screen: ${describeSettings(settingsOf(device))}.`,
              };
            const next = await devices.setSettings(owner, device.id, patch);
            return {
              changed: true,
              message: `Done. ${device.name}'s idle screen: ${describeSettings(next)}. The device gets it within a few seconds.`,
            };
          }
          if (input.do === "rename") {
            if (!input.new_name?.trim()) return { error: "What should it be called?" };
            const taken = list.some(
              (other) =>
                other.id !== device.id &&
                other.name.toLowerCase() === input.new_name?.trim().toLowerCase(),
            );
            if (taken)
              return { error: "Another device already has that name. Pick a different one." };
            await devices.rename(owner, device.id, input.new_name);
            return { renamed: true, message: `Renamed to “${input.new_name.trim()}”.` };
          }
          if (input.confirm !== true)
            return {
              needsConfirm: true,
              message: `Ask them: remove “${device.name}” for good? It stops working at once and has to be paired again. Only if they say yes, call again with confirm true.`,
            };
          await devices.remove(owner, device.id);
          return {
            removed: true,
            message: `“${device.name}” is removed for good. To use it again it has to be paired again.`,
          };
        } catch (error) {
          if (error instanceof AppError) return { error: error.message };
          throw error;
        }
      },
    },
  ];
}
