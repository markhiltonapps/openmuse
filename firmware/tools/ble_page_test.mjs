// Opens the Bluetooth setup page (apps/mobile/public/watch-setup.html) in a real browser with a pretend watch behind "navigator.bluetooth", and checks what it asks for,
// what it sends (in what order and in what size pieces) and what a person sees.   node firmware/tools/ble_page_test.mjs [screenshot.png]
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const pagePath = fileURLToPath(new URL("../../apps/mobile/public/watch-setup.html", import.meta.url));
let failures = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.log("FAIL:", what); } };

const pretend = (opts) => {
  const SERVICE = "111f83b7-253c-4cfd-b6b6-fd7bbea9386e";
  const NETWORKS = "050b61c0-03c6-4c9f-b99e-36ed8f21a8bf";
  const CREDENTIALS = "0a64e3d3-8962-4e04-b0d4-fb91697267a0";
  const STATUS = "8a419340-a280-4e28-b58d-509c475bbcfa";
  const enc = (s) => new DataView(new TextEncoder().encode(s).buffer);
  const state = (window.__watch = { filters: null, writes: [], status: "ready", reads: 0, disconnected: false, outcome: (opts && opts.outcome) || "ok", handlers: {} });
  const chars = {
    [NETWORKS]: { readValue: async () => enc(JSON.stringify({ n: "5AFE", w: [["Home Wi-Fi", -45, 0], ["<img src=x onerror=window.hacked=1>", -60, 0], ["Cafe Guest", -80, 1]] })) },
    [CREDENTIALS]: {
      writeValueWithResponse: async (v) => { state.writes.push(new TextDecoder().decode(v)); const all = state.writes.join(""); if (all.split("\n").length >= 4) state.status = "trying"; },
    },
    [STATUS]: { readValue: async () => { state.reads++; if (state.status === "trying" && state.reads > 3) state.status = state.outcome; return enc(state.status); } },
  };
  const service = { getCharacteristic: async (u) => chars[u] };
  const device = {
    name: "Neddy-5AFE",
    addEventListener: (n, f) => { state.handlers[n] = f; },
    gatt: { connect: async () => ({ getPrimaryService: async (u) => { if (u !== SERVICE) throw new Error("no such service"); return service; }, disconnect: () => { state.disconnected = true; } }) },
  };
  Object.defineProperty(navigator, "bluetooth", { value: { requestDevice: async (o) => { state.filters = o; return device; } }, configurable: true });
};

const browser = await chromium.launch();
async function open(initScript, arg) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (initScript) await page.addInitScript(initScript, arg);
  await page.goto("file://" + pagePath + "#n=5AFE&k=482913");
  return { page, errors };
}

// 1. The normal path.
{
  const { page, errors } = await open(pretend);
  check((await page.innerText("#devname")) === "Neddy-5AFE", "the page names the watch it is looking for");
  await page.click("#find");
  await page.waitForSelector(".net", { timeout: 5000 });
  const filters = await page.evaluate(() => window.__watch.filters);
  check(filters.filters[0].name === "Neddy-5AFE" && filters.optionalServices[0] === "111f83b7-253c-4cfd-b6b6-fd7bbea9386e", "it asks Chrome for exactly that watch and its service");
  check((await page.locator(".net").count()) === 3, "the watch's three networks are listed");
  check(await page.evaluate(() => window.hacked === undefined), "a network name with markup in it stays text");
  await page.locator(".net").nth(0).click();
  check((await page.inputValue("#ssid")) === "Home Wi-Fi", "tapping a network fills in its name");
  await page.fill("#pass", "pa ss&word=1 " + "x".repeat(30));
  await page.screenshot({ path: process.argv[2] || "/tmp/ble_page.png" });
  await page.click("#go");
  await page.waitForFunction(() => document.getElementById("msg").textContent.includes("Done"), null, { timeout: 8000 });
  const w = await page.evaluate(() => window.__watch);
  const sent = w.writes.join("");
  check(sent === "482913\nHome Wi-Fi\npa ss&word=1 " + "x".repeat(30) + "\n", "it sends the code, the name and the password, one per line, ending with a new line");
  check(w.writes.every((p) => new TextEncoder().encode(p).length <= 100) && w.writes.length >= 1, "in pieces of at most 100 bytes");
  check(w.disconnected, "it lets go of the watch when done");
  check(errors.length === 0, "no script errors: " + errors.join("; "));
  await page.close();
}
// 2. The watch could not join (wrong password): the button comes back and says why.
{
  const { page } = await open(pretend, { outcome: "fail" });
  await page.click("#find"); await page.waitForSelector(".net");
  await page.fill("#ssid", "Home Wi-Fi"); await page.fill("#pass", "wrongpassword");
  await page.click("#go");
  await page.waitForFunction(() => document.getElementById("msg").textContent.includes("could not join"), null, { timeout: 8000 });
  check(await page.isEnabled("#go"), "after a wrong password the button is usable again");
  await page.close();
}
// 3. An old code.
{
  const { page } = await open(pretend, { outcome: "badkey" });
  await page.click("#find"); await page.waitForSelector(".net");
  await page.fill("#ssid", "Home Wi-Fi"); await page.fill("#pass", "somepassword");
  await page.click("#go");
  await page.waitForFunction(() => document.getElementById("msg").textContent.includes("Scan the QR code"), null, { timeout: 8000 });
  check(true, "an old or wrong code says to scan the watch's QR code again");
  await page.close();
}
// 4. Passwords the watch can't use are stopped on the phone.
{
  const { page } = await open(pretend);
  await page.click("#find"); await page.waitForSelector(".net");
  await page.fill("#ssid", "Home Wi-Fi"); await page.fill("#pass", "short");
  await page.click("#go");
  check((await page.innerText("#msg")).includes("8 to 63"), "a too-short password is refused with the rule");
  check((await page.evaluate(() => window.__watch.writes.length)) === 0, "and nothing is sent");
  await page.close();
}
// 4b. A long name with accents (2 bytes each) and a long password: sent whole, in more than one piece, none over 100 bytes, and read back unchanged.
{
  const { page } = await open(pretend);
  await page.click("#find"); await page.waitForSelector(".net");
  const longName = "\u00e9".repeat(32), longPass = "p".repeat(63);
  await page.fill("#ssid", longName); await page.fill("#pass", longPass);
  await page.click("#go");
  await page.waitForFunction(() => document.getElementById("msg").textContent.includes("Done"), null, { timeout: 8000 });
  const w = await page.evaluate(() => window.__watch);
  check(w.writes.length >= 2 && w.writes.every((p) => new TextEncoder().encode(p).length <= 100), "a long name and password go in several pieces of at most 100 bytes");
  check(w.writes.join("") === "482913\n" + longName + "\n" + longPass + "\n", "and arrive unchanged");
  await page.close();
}
// 5. No Bluetooth in this browser (an iPhone, Firefox): a plain explanation, no broken button.
{
  const { page } = await open(() => { Object.defineProperty(navigator, "bluetooth", { value: undefined, configurable: true }); });
  check(await page.isVisible("#unsupported") && !(await page.isVisible("#find")), "without Bluetooth the page explains and offers the watch's other setup");
  await page.close();
}
// 6. The person closes Chrome's chooser: friendly words.
{
  const { page } = await open(() => { Object.defineProperty(navigator, "bluetooth", { value: { requestDevice: async () => { throw new Error("User cancelled the requestDevice() chooser."); } }, configurable: true }); });
  await page.click("#find");
  await page.waitForFunction(() => document.getElementById("msg").textContent.includes("No watch was picked"));
  check(true, "cancelling the chooser says what to do next");
  await page.close();
}
await browser.close();
console.log(`${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
