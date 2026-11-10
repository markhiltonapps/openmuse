// Opens the watch's Wi-Fi setup page (neddy_setup_page.h) in a real browser against a pretend watch and checks what a person would see.
//   node firmware/tools/setup_page_test.mjs [screenshot.png]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const src = readFileSync(new URL("../neddy_device/neddy_setup_page.h", import.meta.url), "utf8");
const html = src.slice(src.indexOf('R"HTML(') + 7, src.indexOf(')HTML"'));
let failures = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.log("FAIL:", what); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let posted = null, state = "trying", scans = 0;
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  const json = (o) => route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
  if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
  if (url.pathname === "/scan") {
    scans++;
    if (scans === 1) return json({ scanning: true });          // the first answer says "still looking"
    return json({ networks: [
      { ssid: "Home Wi-Fi", rssi: -45, open: false },
      { ssid: "<img src=x onerror=window.hacked=1>", rssi: -60, open: false },
      { ssid: "Cafe Guest", rssi: -80, open: true },
    ] });
  }
  if (url.pathname === "/connect") { posted = route.request().postData(); return json({ ok: true }); }
  if (url.pathname === "/status") return json({ state });
  return route.fulfill({ status: 404, body: "" });
});
await page.goto("http://192.168.4.1/");
await page.waitForSelector(".net", { timeout: 8000 });
check((await page.locator(".net").count()) === 3, "the page lists the three networks (after the watch said it was still scanning)");
check(await page.evaluate(() => window.hacked === undefined), "a network name with markup in it stays text");
check((await page.locator(".net").nth(1).innerText()).includes("<img"), "and is shown as the text it is");
check((await page.locator(".net").nth(2).innerText()).includes("open"), "an open network says so");
await page.locator(".net").nth(0).click();
check((await page.inputValue("#ssid")) === "Home Wi-Fi", "tapping a network fills in its name");
check((await page.getAttribute("#pass", "type")) === "password", "the password is hidden at first");
await page.check("#show");
check((await page.getAttribute("#pass", "type")) === "text", "Show password shows it");
await page.fill("#pass", "pa ss&word=1");
await page.screenshot({ path: process.argv[2] || "/tmp/setup_page.png" });
await page.click("#go");
await page.waitForFunction(() => document.getElementById("msg").textContent.includes("Connecting"));
const form = new URLSearchParams(posted || "");
check(form.get("ssid") === "Home Wi-Fi" && form.get("pass") === "pa ss&word=1", "the choice is sent with odd characters intact");
state = "ok";
await page.waitForFunction(() => document.getElementById("msg").textContent.includes("Done"), null, { timeout: 8000 });
check(true, "it says Done when the watch is connected");
// A wrong password: the button comes back and says why.
state = "fail"; posted = null;
await page.reload();
await page.waitForSelector(".net");
await page.fill("#ssid", "Home Wi-Fi"); await page.fill("#pass", "wrong");
await page.click("#go");
await page.waitForFunction(() => document.getElementById("msg").textContent.includes("could not connect"), null, { timeout: 8000 });
check(await page.isEnabled("#go"), "after a wrong password the Connect button is usable again");
check(errors.length === 0, "no script errors: " + errors.join("; "));
await browser.close();
console.log(`${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
