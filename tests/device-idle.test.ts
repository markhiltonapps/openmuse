import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createStore } from "../apps/server/src/db.ts";
import { idleInfo, zoneOffsetMinutes } from "../apps/server/src/device-idle.ts";
import { DeviceBridge } from "../apps/server/src/device-socket.ts";
import {
  DEFAULT_DEVICE_SETTINGS,
  Devices,
  deviceToolSpecs,
  pairClaimSchema,
  settingsOf,
} from "../apps/server/src/devices.ts";
import type { WeatherService } from "../apps/server/src/weather.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, what: string, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail(`Timed out waiting for ${what}`);
    await wait(5);
  }
}

// 4:15 PM on Monday 9 November 2026 in Chicago (CST, UTC-6).
const NOW = Date.parse("2026-11-09T22:15:00Z");

const forecast = {
  forOwner: async () => ({
    weather: {
      place: "Houston, Texas",
      timeZone: "America/Chicago",
      now: { temp: 72, feelsLike: 72, sky: "Partly cloudy", emoji: "⛅" },
      today: { high: 80, low: 65, rain: 30 },
      hours: [],
      days: [],
      alerts: [],
      updatedAt: "",
    },
  }),
} as unknown as WeatherService;

const event = (title: string, start: string, end: string, allDay = false) => ({
  id: title,
  title,
  start,
  end,
  allDay,
  app: "outlook",
});

test("the person's clock offset is worked out for their zone, daylight saving included", () => {
  assert.equal(zoneOffsetMinutes(NOW, "America/Chicago"), -360);
  assert.equal(zoneOffsetMinutes(NOW, "America/New_York"), -300);
  assert.equal(zoneOffsetMinutes(Date.parse("2026-07-01T12:00:00Z"), "America/Chicago"), -300);
  assert.equal(zoneOffsetMinutes(NOW, "Asia/Kolkata"), 330);
  assert.equal(zoneOffsetMinutes(NOW, "UTC"), 0);
});

test("the idle facts: the time and offset, the weather in brief, the next meeting that hasn't ended", async () => {
  const device = { id: "d1", name: "Phone", model: "x", createdAt: "" };
  const deps = {
    timeZone: async () => "America/Chicago",
    weather: () => forecast,
    calendar: async () => ({
      events: [
        event("Holiday", "2026-11-09", "2026-11-10", true),
        event("Earlier", "2026-11-09T20:00:00Z", "2026-11-09T21:00:00Z"),
        event("Team sync", "2026-11-10T16:00:00Z", "2026-11-10T17:00:00Z"),
        event("Amazon interview", "2026-11-10T20:30:00Z", "2026-11-10T21:30:00Z"),
      ],
      checked: ["outlook"],
      failed: [],
    }),
    now: () => NOW,
  };
  const info = await idleInfo(deps, "o", device);
  assert.deepEqual(info, {
    type: "idle",
    t: Math.floor(NOW / 1000),
    off: -360,
    after: 10,
    dim: 1,
    da: 0,
    sw: 1,
    sm: 1,
    sb: 1,
    fps: 1,
    face: 0,
    rw: 0,
    vol: 85,
    bs: 1,
    nap: 1,
    wt: 72,
    ws: "Partly cloudy",
    wi: "partly",
    wh: 80,
    wl: 65,
    mc: 1,
    mt: "Team sync",
    ms: Date.parse("2026-11-10T16:00:00Z") / 1000,
    me: Date.parse("2026-11-10T17:00:00Z") / 1000,
  });

  // A meeting in progress counts; a calendar with nothing left says so (mc without a meeting).
  const busy = await idleInfo(
    {
      ...deps,
      calendar: async () => ({
        events: [event("Standup", "2026-11-09T22:00:00Z", "2026-11-09T22:30:00Z")],
        checked: ["outlook"],
        failed: [],
      }),
    },
    "o",
    device,
  );
  assert.equal(busy.mt, "Standup");
  const none = await idleInfo(
    { ...deps, calendar: async () => ({ events: [], checked: ["outlook"], failed: [] }) },
    "o",
    device,
  );
  assert.equal(none.mc, 1);
  assert.equal(none.mt, undefined);
  // Nothing is claimed when the calendar isn't connected or the forecast isn't available.
  const unknown = await idleInfo(
    {
      ...deps,
      weather: () =>
        ({ forOwner: async () => ({ unavailable: "no-area" }) }) as unknown as WeatherService,
      calendar: async () => ({ events: [], checked: [], failed: [] }),
    },
    "o",
    device,
  );
  assert.equal(unknown.wt, undefined);
  assert.equal(unknown.mc, undefined);
});

test("the person's settings turn parts of the idle screen off, and 0 turns it off", async () => {
  const device = {
    id: "d1",
    name: "Phone",
    model: "x",
    createdAt: "",
    settings: { showWeather: false, dim: false },
  };
  let weatherAsked = 0;
  const deps = {
    timeZone: async () => "UTC",
    weather: () =>
      ({
        forOwner: async () => {
          weatherAsked++;
          return { unavailable: "off" };
        },
      }) as unknown as WeatherService,
    calendar: async () => ({ events: [], checked: ["outlook"], failed: [] }),
    now: () => NOW,
  };
  const info = await idleInfo(deps, "o", device);
  assert.equal(info.sw, 0);
  assert.equal(info.dim, 0);
  assert.equal(weatherAsked, 0);
  const off = await idleInfo(deps, "o", { ...device, settings: { idleAfter: 0 } });
  assert.equal(off.after, 0);
  assert.equal(off.mc, undefined);
  assert.deepEqual(settingsOf({}), DEFAULT_DEVICE_SETTINGS);
});

test('"my watch" finds the device, whatever it is named', async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const [tool] = deviceToolSpecs(devices, "o");
  assert.ok(tool);
  // One device: "my watch" names the kind of thing, not the device, so it still finds it.
  const one = (await tool.execute({
    do: "settings",
    name: "my watch",
    idle_after_seconds: 30,
  })) as { changed?: boolean; error?: string };
  assert.equal(one.changed, true, one.error);
  assert.match(String(tool.description), /watch/);
  // Two devices, one really named Watch: the word picks it.
  const second = await devices.start("Waveshare", "1.2.3.5");
  await devices.claim("o", pairClaimSchema.parse({ code: second.code, name: "Watch" }));
  const two = (await tool.execute({
    do: "settings",
    name: "the watch",
    idle_after_seconds: 45,
  })) as { changed?: boolean; message?: string };
  assert.equal(two.changed, true);
  assert.match(two.message ?? "", /^Done\. Watch's idle screen/);
  await db.close();
});

test("the home screen defaults to ten seconds and the battery can be hidden by voice", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const [tool] = deviceToolSpecs(devices, "o");
  assert.ok(tool);
  const asked = (await tool.execute({ do: "settings", name: "my watch" })) as { message?: string };
  assert.match(
    asked.message ?? "",
    /after 10 seconds of quiet it shows the clock, the weather, the next meeting, the battery level.*animation is normal; the watch face is info/,
  );
  const hidden = (await tool.execute({ do: "settings", show_battery: false })) as {
    message?: string;
  };
  assert.doesNotMatch(hidden.message ?? "", /the battery level/);
  await db.close();
});

test("raise to wake is off until asked, and by voice it goes on and off and reaches the watch", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const [tool] = deviceToolSpecs(devices, "o");
  assert.ok(tool);
  const deps = {
    timeZone: async () => "UTC",
    weather: () => undefined,
    calendar: async () => undefined,
    now: () => 1_800_000_000_000,
  };
  const first = (await devices.list("o"))[0];
  assert.ok(first);
  assert.equal((await idleInfo(deps, "o", first)).rw, 0, "a watch that never asked has it off");
  const asked = (await tool.execute({ do: "settings" })) as { message?: string };
  assert.match(asked.message ?? "", /raise to wake is off/);
  const on = (await tool.execute({ do: "settings", raise_to_wake: true })) as {
    changed?: boolean;
    message?: string;
  };
  assert.equal(on.changed, true);
  assert.match(on.message ?? "", /raise to wake is on \(raising the wrist brightens the screen/);
  const second = (await devices.list("o"))[0];
  assert.ok(second);
  assert.equal((await idleInfo(deps, "o", second)).rw, 1, "the watch is told it is on");
  // With dimming off there is nothing to brighten, and the agent says so rather than promising a wake.
  const noDim = (await tool.execute({ do: "settings", dim: false })) as { message?: string };
  assert.match(noDim.message ?? "", /raise to wake is on, but the screen never dims/);
  const off = (await tool.execute({ do: "settings", raise_to_wake: false })) as {
    message?: string;
  };
  assert.match(off.message ?? "", /raise to wake is off/);
  const third = (await devices.list("o"))[0];
  assert.ok(third);
  assert.equal((await idleInfo(deps, "o", third)).rw, 0);
  // Speaker volume: 85 until the person asks, then what they chose (0 to 100, never outside it).
  assert.equal((await idleInfo(deps, "o", third)).vol, 85);
  const quieter = (await tool.execute({ do: "settings", volume: 45 })) as { message?: string };
  assert.match(quieter.message ?? "", /the speaker volume is 45 percent/);
  const fourth = (await devices.list("o"))[0];
  assert.ok(fourth);
  assert.equal((await idleInfo(deps, "o", fourth)).vol, 45, "the watch is told the volume");
  assert.equal((await devices.setSettings("o", fourth.id, { volume: 400 })).volume, 100);
  assert.equal((await devices.setSettings("o", fourth.id, { volume: -5 })).volume, 0);
  const muted = (await tool.execute({ do: "settings" })) as { message?: string };
  assert.match(muted.message ?? "", /the speaker is muted/);
  await devices.setSettings("o", fourth.id, { volume: 85 });
  // Turning the idle screen off still reports it.
  const idleOff = (await tool.execute({ do: "settings", idle_after_seconds: 0 })) as {
    message?: string;
  };
  assert.match(
    idleOff.message ?? "",
    /the idle screen is off; the speaker volume is 85 percent; battery saver is on[^;]*; raise to wake is off/,
  );
  await db.close();
});

test("dim after N seconds: said once, it turns dimming on, reaches the watch, and 0 goes back to the usual minute", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const [tool] = deviceToolSpecs(devices, "o");
  assert.ok(tool);
  const deps = {
    timeZone: async () => "UTC",
    weather: () => undefined,
    calendar: async () => undefined,
    now: () => 1_800_000_000_000,
  };
  await tool.execute({ do: "settings", dim: false });
  const set = (await tool.execute({ do: "settings", dim_after_seconds: 5 })) as {
    message?: string;
  };
  assert.match(set.message ?? "", /dims after 5 seconds of quiet/);
  const one = (await devices.list("o"))[0];
  assert.ok(one);
  assert.equal(settingsOf(one).dim, true, "saying how soon turns dimming on");
  const info = await idleInfo(deps, "o", one);
  assert.equal(info.da, 5);
  assert.equal(info.dim, 1);
  const back = (await tool.execute({ do: "settings", dim_after_seconds: 0 })) as {
    message?: string;
  };
  assert.match(back.message ?? "", /dims after a minute/);
  const two = (await devices.list("o"))[0];
  assert.ok(two);
  assert.equal((await idleInfo(deps, "o", two)).da, 0);
  // A silly number is held to an hour.
  const big = await devices.setSettings("o", two.id, { dimAfter: 99999 });
  assert.equal(big.dimAfter, 3600);
  await db.close();
});

test("the chat changes a device's idle screen by what's said", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const [tool] = deviceToolSpecs(devices, "o");
  assert.ok(tool);
  const seen: string[] = [];
  devices.onSettingsChanged((id) => seen.push(id));
  const set = (await tool.execute({
    do: "settings",
    idle_after_seconds: 60,
    dim: false,
    show_weather: false,
  })) as {
    changed?: boolean;
    message?: string;
  };
  assert.equal(set.changed, true);
  assert.match(
    set.message ?? "",
    /after 60 seconds of quiet it shows the clock, the next meeting, the battery level, and stays bright; Neddy's animation is normal; the watch face is info/,
  );
  const [device] = await devices.list("o");
  assert.deepEqual(settingsOf(device as never), {
    idleAfter: 60,
    dim: false,
    dimAfter: 0,
    showWeather: false,
    showMeeting: true,
    showBattery: true,
    animation: "normal",
    face: "info",
    raiseToWake: false,
    volume: 85,
    batterySaver: true,
    sleepWhenIdle: true,
  });
  assert.equal(seen.length, 1);
  // Asking without changing anything just says how it is; 0 turns the idle screen off; silly numbers are held to the limits.
  const asked = (await tool.execute({ do: "settings" })) as { message?: string };
  assert.match(asked.message ?? "", /after 60 seconds/);
  const off = (await tool.execute({ do: "settings", idle_after_seconds: 0 })) as {
    message?: string;
  };
  assert.match(off.message ?? "", /the idle screen is off/);
  const listed = (await tool.execute({ do: "list" })) as { devices: { idleScreen: string }[] };
  assert.match(listed.devices[0]?.idleScreen ?? "", /off/);
  await db.close();
});

test("a device is sent its idle facts when it connects and when its settings change", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const sent: string[] = [];
  const server = createServer();
  const bridge = new DeviceBridge(
    devices,
    () => undefined,
    () => undefined,
    Date.now,
    async (_owner, device) => {
      sent.push(`${device.name}:${settingsOf(device).idleAfter}`);
      const animation = settingsOf(device).animation;
      return {
        type: "idle",
        after: settingsOf(device).idleAfter,
        fps: animation === "saver" ? 0 : animation === "smooth" ? 2 : 1,
        face: settingsOf(device).face === "analog" ? 1 : settingsOf(device).face === "neon" ? 2 : 0,
        vol: settingsOf(device).volume,
        t: 1,
      };
    },
  );
  bridge.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const polled = await devices.poll(started.pollToken);
  const token = (polled as { token: string }).token;
  const ws = new WebSocket(
    `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/device/audio`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const text: Record<string, unknown>[] = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) text.push(JSON.parse(data.toString()));
  });
  await once(ws, "open");
  await until(() => text.some((event) => event.type === "idle"), "the idle facts on connect");
  assert.deepEqual(sent, ["Desk:10"]);

  const [device] = await devices.list("o");
  await devices.setSettings("o", (device as { id: string }).id, { idleAfter: 90 });
  await until(
    () => text.filter((event) => event.type === "idle").length === 2,
    "the idle facts after a change",
  );
  assert.deepEqual(sent, ["Desk:10", "Desk:90"]);
  assert.equal(text.filter((event) => event.type === "idle")[1]?.after, 90);
  // A setting changed on the watch itself (its menu) is kept and said back.
  ws.send(JSON.stringify({ type: "device.setting", key: "animation", value: 2 }));
  await until(
    () => text.filter((event) => event.type === "idle").some((event) => event.fps === 2),
    "the animation setting kept and sent back",
  );
  assert.equal(settingsOf((await devices.list("o"))[0] as never).animation, "smooth");
  ws.send(JSON.stringify({ type: "device.setting", key: "animation", value: -5 }));
  await until(
    () => text.filter((event) => event.type === "idle").some((event) => event.fps === 0),
    "an out-of-range level is held to the limits (saver)",
  );
  // The watch face changed from the watch's menu is kept and said back too.
  ws.send(JSON.stringify({ type: "device.setting", key: "face", value: 1 }));
  await until(
    () => text.filter((event) => event.type === "idle").some((event) => event.face === 1),
    "the watch face kept and sent back",
  );
  assert.equal(settingsOf((await devices.list("o"))[0] as never).face, "analog");
  // The volume changed on the watch's own volume screen is kept and said back too (held to 0..100).
  ws.send(JSON.stringify({ type: "device.setting", key: "volume", value: 40 }));
  await until(
    () => text.filter((event) => event.type === "idle").some((event) => event.vol === 40),
    "the volume kept and sent back",
  );
  assert.equal(settingsOf((await devices.list("o"))[0] as never).volume, 40);
  ws.send(JSON.stringify({ type: "device.setting", key: "volume", value: 900 }));
  await until(
    () => text.filter((event) => event.type === "idle").some((event) => event.vol === 100),
    "an out-of-range volume is held to 100",
  );
  ws.close();
  bridge.stop();
  server.close();
  await db.close();
});

test("battery saver is on by default, goes on and off by voice and reaches the watch; the watch's report is kept and said back", async () => {
  const db = await createStore();
  let now = 1_800_000_000_000;
  const devices = new Devices(db, () => now);
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const [tool] = deviceToolSpecs(devices, "o");
  assert.ok(tool);
  const deps = {
    timeZone: async () => "UTC",
    weather: () => undefined,
    calendar: async () => undefined,
    now: () => now,
  };
  const device = (await devices.list("o"))[0];
  assert.ok(device);
  assert.equal((await idleInfo(deps, "o", device)).bs, 1, "on until the person says otherwise");
  const off = (await tool.execute({ do: "settings", battery_saver: false })) as {
    message?: string;
  };
  assert.match(off.message ?? "", /battery saver is off/);
  const again = (await devices.list("o"))[0];
  assert.ok(again);
  assert.equal((await idleInfo(deps, "o", again)).bs, 0, "the watch is told it is off");
  // Sleeping with Wi-Fi off when idle: on until the person says otherwise, the watch is told, and it can be turned off by voice.
  assert.equal((await idleInfo(deps, "o", again)).nap, 1, "sleep when idle is on by default");
  const awake = (await tool.execute({
    do: "settings",
    battery_saver: true,
    sleep_when_idle: false,
  })) as {
    message?: string;
  };
  assert.match(awake.message ?? "", /stays connected/);
  const third = (await devices.list("o"))[0];
  assert.ok(third);
  assert.equal((await idleInfo(deps, "o", third)).nap, 0, "the watch is told to stay connected");
  await tool.execute({ do: "settings", sleep_when_idle: true });
  // Before any report the agent says so; after one it says what the watch reported, and how old it is.
  const before = (await tool.execute({ do: "list" })) as { devices: { report: string }[] };
  assert.match(before.devices[0]?.report ?? "", /no report yet/);
  devices.setStatus(again.id, {
    battery: 72,
    millivolts: 3950,
    charging: false,
    usb: false,
    wifiDbm: -61,
    upSeconds: 2040,
    connects: 3,
    saver: true,
  });
  now += 5 * 60_000;
  const after = (await tool.execute({ do: "list" })) as { devices: { report: string }[] };
  assert.match(after.devices[0]?.report ?? "", /battery 72% \(3\.95 V\), running on the battery/);
  assert.match(
    after.devices[0]?.report ?? "",
    /Wi-Fi -61 dBm, on for 34 minutes, connected 3 times/,
  );
  assert.match(after.devices[0]?.report ?? "", /reported 5 minutes ago/);
  await db.close();
});

test("a watch's status report over its socket is kept and logged (bad numbers are dropped, not trusted)", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const lines: string[] = [];
  const server = createServer();
  const bridge = new DeviceBridge(
    devices,
    () => undefined,
    (line) => lines.push(line),
    Date.now,
    async () => ({ type: "idle", t: 1 }),
  );
  bridge.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const started = await devices.start("Waveshare", "1.2.3.4");
  await devices.claim("o", pairClaimSchema.parse({ code: started.code, name: "Desk" }));
  const polled = await devices.poll(started.pollToken);
  const token = (polled as { token: string }).token;
  const ws = new WebSocket(
    `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/device/audio`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  await once(ws, "open");
  const id = (await devices.list("o"))[0]?.id as string;
  ws.send(
    JSON.stringify({
      type: "device.status",
      battery: 64,
      mv: 3890,
      charging: 0,
      usb: 0,
      rssi: -58,
      up: 600,
      connects: 2,
      saver: 1,
    }),
  );
  await until(() => devices.statusOf(id)?.battery === 64, "the status kept");
  assert.ok(lines.some((line) => line.includes("status: battery 64% 3890 mV on battery")));
  assert.equal(devices.statusOf(id)?.saver, true);
  ws.send(JSON.stringify({ type: "device.status", battery: 900, mv: "x", rssi: 50, up: -4 }));
  await until(() => devices.statusOf(id)?.battery === null, "a nonsense battery is dropped");
  assert.equal(devices.statusOf(id)?.wifiDbm, null);
  ws.close();
  bridge.stop();
  server.close();
  await db.close();
});
