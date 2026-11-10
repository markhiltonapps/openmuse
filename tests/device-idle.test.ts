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
    sw: 1,
    sm: 1,
    sb: 1,
    fps: 1,
    face: 0,
    rw: 0,
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
  assert.doesNotMatch(hidden.message ?? "", /battery/);
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
  // Turning the idle screen off still reports it.
  const idleOff = (await tool.execute({ do: "settings", idle_after_seconds: 0 })) as {
    message?: string;
  };
  assert.match(idleOff.message ?? "", /the idle screen is off; raise to wake is off/);
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
    showWeather: false,
    showMeeting: true,
    showBattery: true,
    animation: "normal",
    face: "info",
    raiseToWake: false,
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
  ws.close();
  bridge.stop();
  server.close();
  await db.close();
});
