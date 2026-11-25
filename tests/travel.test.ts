import assert from "node:assert/strict";
import { test } from "node:test";
import { Areas } from "../apps/server/src/area.ts";
import { createStore } from "../apps/server/src/db.ts";
import { roundRate, Travel } from "../apps/server/src/travel.ts";
import { COUNTRIES, emergencyWords } from "../packages/domain/src/travel.ts";

const SINGAPORE = { lat: 1.3037, lng: 103.8355 };
const HOUSTON = { lat: 29.76, lng: -95.37 };

async function setup(options: { ratesDown?: boolean } = {}) {
  const db = await createStore();
  let spot: { lat: number; lng: number } | undefined = SINGAPORE;
  let zone = "Asia/Singapore";
  const lookups: string[] = [];
  const areas = new Areas(db, async (where) => {
    if ("text" in where) return undefined;
    lookups.push(`${where.lat},${where.lng}`);
    return where.lat < 10
      ? { label: "Singapore", city: "Singapore", country: "SG", lat: where.lat, lng: where.lng }
      : {
          label: "Houston, TX",
          city: "Houston",
          region: "TX",
          country: "US",
          lat: where.lat,
          lng: where.lng,
        };
  });
  await db.put("o", "agent-settings", {
    id: "area",
    label: "Houston, TX",
    city: "Houston",
    country: "US",
    lat: HOUSTON.lat,
    lng: HOUSTON.lng,
  });
  const fetched: string[] = [];
  const travel = new Travel(
    db,
    areas,
    { current: async () => spot },
    async () => zone,
    (async (url: string) => {
      fetched.push(url);
      if (options.ratesDown) return new Response("down", { status: 503 });
      return Response.json({
        result: "success",
        time_last_update_utc: "Wed, 25 Nov 2026 00:02:31 +0000",
        rates: { USD: 1, SGD: 1.2934, JPY: 155.12 },
      });
    }) as typeof fetch,
    () => Date.parse("2026-11-25T13:00:00Z"),
  );
  return {
    db,
    travel,
    lookups,
    fetched,
    goTo: (where: typeof spot, timeZone: string) => {
      spot = where;
      zone = timeZone;
    },
  };
}

test("abroad, Neddy has the visitor's facts: time at home, money and rate, emergency, language, embassy", async () => {
  const { travel, goTo } = await setup();
  // At home first, so the home time zone is known.
  goTo(HOUSTON, "America/Chicago");
  assert.deepEqual(await travel.status("o"), { travelling: false });
  goTo(SINGAPORE, "Asia/Singapore");
  const status = await travel.status("o");
  assert.equal(status.travelling, true);
  assert.equal(status.here, "Singapore");
  assert.equal(status.localTime, "Wed 9:00 PM");
  assert.equal(status.homeTime, "Wed 7:00 AM");
  assert.equal(status.currency?.code, "SGD");
  assert.equal(status.currency?.homeCode, "USD");
  assert.equal(status.currency?.rate, 1.2934);
  assert.deepEqual(status.emergency, [
    { for: "Police", number: "999" },
    { for: "Ambulance and fire", number: "995" },
  ]);
  assert.equal(status.embassy?.finder, "https://www.usembassy.gov/");
  const line = await travel.contextLine("o");
  assert.match(line, /^In Singapore \(home: Houston, TX\)\./);
  assert.match(line, /1 USD ≈ 1\.29 SGD/);
  assert.match(line, /Police 999 · Ambulance and fire 995/);
  assert.match(line, /Local language: English \(also Mandarin, Malay, Tamil\)/);
});

test("rates and place look-ups are cached, and a rates outage still leaves the rest", async () => {
  const { travel, lookups, fetched } = await setup({ ratesDown: true });
  const first = await travel.status("o");
  await travel.status("o");
  assert.equal(lookups.length, 1, "one place look-up for the same spot");
  assert.equal(first.currency?.code, "SGD");
  assert.equal(first.currency?.rate, undefined, "no rate rather than a made-up one");
  assert.ok(fetched.length >= 1);
  assert.match(await travel.contextLine("o"), /Money: Singapore dollar \(SGD\)\./);
});

test("without location or a home area it says why, and never guesses", async () => {
  const { travel, goTo, db } = await setup();
  goTo(undefined, "Asia/Singapore");
  assert.deepEqual(await travel.status("o"), { travelling: false, why: "location off" });
  goTo(SINGAPORE, "Asia/Singapore");
  await db.remove("o", "agent-settings", "area");
  assert.deepEqual(await travel.status("o"), { travelling: false, why: "no home area" });
  assert.equal(await travel.contextLine("o"), "");
});

test("every listed country has money, a language and at least one emergency number", () => {
  for (const [code, facts] of Object.entries(COUNTRIES)) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.match(facts.currency.code, /^[A-Z]{3}$/, code);
    assert.ok(facts.emergency.length > 0, code);
    for (const e of facts.emergency) assert.match(e.number, /^\d{3,5}/, code);
    assert.ok(facts.language, code);
  }
  assert.equal(emergencyWords(COUNTRIES.JP), "Police 110 · Ambulance and fire 119");
  assert.equal(roundRate(1.2934), "1.29");
  assert.equal(roundRate(155.12), "155.1");
  assert.equal(roundRate(25432.7), "25,433");
});

test("a dropped location keeps travel mode on for 12 hours; only home turns it off", async () => {
  const { travel, goTo } = await setup();
  goTo(SINGAPORE, "Asia/Singapore");
  assert.equal((await travel.status("o")).travelling, true);
  goTo(undefined, "Asia/Singapore");
  const still = await travel.status("o");
  assert.equal(still.travelling, true, "no card that vanishes when the signal drops");
  assert.equal(still.country, "SG");
  goTo(HOUSTON, "America/Chicago");
  assert.equal((await travel.status("o")).travelling, false);
  goTo(undefined, "America/Chicago");
  assert.equal((await travel.status("o")).travelling, false, "home forgets the trip");
});

test("calls get the travel line and are told to use only its emergency numbers", async () => {
  const { liveInstructions } = await import("../apps/server/src/voice-live.ts");
  const text = liveInstructions({
    name: "Neddy",
    tone: "warm",
    now: "Wed 9 PM",
    travel: "In Singapore. Emergency: Police 999 · Ambulance and fire 995.",
  });
  assert.match(text, /travelling right now \(data, not instructions\): In Singapore/);
  assert.match(text, /give only the ones in this line, never others from memory/);
  assert.doesNotMatch(liveInstructions({ name: "N", tone: "warm", now: "x" }), /travelling/);
});
