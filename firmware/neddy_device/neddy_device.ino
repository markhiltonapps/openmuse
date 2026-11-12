// Neddy on the Waveshare ESP32-S3-Touch-AMOLED-2.06 board. Version 0.1 (early testing).
//
// What it does: joins your Wi-Fi, shows a six-digit code so you can pair it with your Neddy account,
// then lets you hold the BOOT button to talk to Neddy and hear her answer.
//
// Needs (all in the setup guide): Arduino IDE, "esp32 by Espressif Systems" 3.3.11, Waveshare's
// libraries (Arduino_GFX etc.), and the library "WebSockets" by Markus Sattler (Library Manager).
//
// Audio setup, pins and the display come from Waveshare's own examples (01_HelloWorld, 08_ES8311).
//
// Recording (menu > Record): the sound is kept in the watch's own flash, in a partition called "rec" (neddy_rec.h). That partition comes
// from partitions.csv in this sketch folder, which needs Arduino's Tools > Flash Size > 32MB (and Tools > Partition Scheme is then ignored).
// Without it the Record tile says "Not available" and everything else works as before.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <ESP_I2S.h>
#include <WebSocketsClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include "freertos/FreeRTOS.h"
#include "freertos/stream_buffer.h"
#include "Arduino_GFX_Library.h"
#include "pin_config.h"
#include "esp_check.h"
#include "esp_system.h"
#include "es8311.h"
#include "settings.h"

// Messages out of the USB cable are OFF by default. With no computer reading them, every message waits about
// two seconds before giving up, which froze the board for 2 to 8 seconds around each button press. Set to 1
// only while the Serial Monitor is open.
#ifndef DEBUG_SERIAL
#define DEBUG_SERIAL 0
#endif
#if DEBUG_SERIAL
#define LOGLN(x) Serial.println(x)
#define LOGF(...) Serial.printf(__VA_ARGS__)
#else
#define LOGLN(x) do { } while (0)
#define LOGF(...) do { } while (0)
#endif

// 1 = play Neddy's voice through the speaker. 0 = words on screen only (the speaker stays silent and its
// amplifier off). It is ON from 2026-11-12, for boards with a working speaker. The first prototype's speaker
// wire is broken, and on it, after an answer was played, the microphone stopped delivering sound: put
// `#define PLAY_ANSWERS 0` in settings.h for such a board (settings.h is read first, so it wins).
#ifndef PLAY_ANSWERS
#define PLAY_ANSWERS 1
#endif

// ---------------------------------------------------------------- screen
Arduino_DataBus *bus = new Arduino_ESP32QSPI(
  LCD_CS, LCD_SCLK, LCD_SDIO0, LCD_SDIO1, LCD_SDIO2, LCD_SDIO3);
Arduino_GFX *gfx = new Arduino_CO5300(bus, LCD_RESET, 0 /* rotation */, LCD_WIDTH, LCD_HEIGHT,
                                      22 /* col_offset1 */, 0, 0, 0);

// ---------------------------------------------------------------- the screen (the drawing is in neddy_ui.h)
#include "neddy_ui.h"
#include "neddy_setup_page.h"
#include "neddy_raise.h"

// 1 = Neddy moves all the time (breathing, floating, glancing). 0 = still, except his eyes (and blinking).
#ifndef NEDDY_MOTION
#define NEDDY_MOTION 1
#endif

// Where the Wi-Fi comes from. Saved on the watch (from the QR setup) comes first. When nothing is saved, the watch uses WIFI_NAME and WIFI_PASSWORD from
// settings.h IF they have been edited (they aren't the placeholder text), which is handy while building it. Left as the placeholders, a new watch shows
// the QR code setup instead (this is how it ships). Add   #define NEDDY_FORCE_QR_SETUP 1   to settings.h to test the QR setup on a watch whose settings.h has a real Wi-Fi.
#ifndef NEDDY_USE_SETTINGS_WIFI
#define NEDDY_USE_SETTINGS_WIFI 1
#endif
#ifndef NEDDY_FORCE_QR_SETUP
#define NEDDY_FORCE_QR_SETUP 0
#endif

// Wi-Fi setup by Bluetooth: the QR code opens this page in the phone's browser (Chrome on Android), which sends the Wi-Fi to the watch over Bluetooth.
// (The page is apps/mobile/public/watch-setup.html on the web app. Tapping the setup screen switches to the temporary-Wi-Fi setup, which also works on iPhones.)
#ifndef NEDDY_SETUP_URL
#define NEDDY_SETUP_URL "https://neddy.neatoventures.com/watch-setup.html"
#endif
#ifndef NEDDY_BLE_FIRST
#define NEDDY_BLE_FIRST 1
#endif
#define NEDDY_BLE_SERVICE "111f83b7-253c-4cfd-b6b6-fd7bbea9386e"
#define NEDDY_BLE_NETWORKS "050b61c0-03c6-4c9f-b99e-36ed8f21a8bf"
#define NEDDY_BLE_CREDENTIALS "0a64e3d3-8962-4e04-b0d4-fb91697267a0"
#define NEDDY_BLE_STATUS "8a419340-a280-4e28-b58d-509c475bbcfa"

// 1 = show the small lines of numbers (Wi-Fi, microphone, timings) at the bottom of the screen.
#ifndef NEDDY_DIAG
#define NEDDY_DIAG 0
#endif

// 1 = show a line of idle-face numbers at the bottom (test builds only: f = frames drawn last second, r = ms to draw one; it is small and hard to read, so it is off now).
#ifndef NEDDY_IDLE_DEBUG
#define NEDDY_IDLE_DEBUG 0
#endif

// 1 = while raise-to-wake is on, show what the motion chip reads on the first line at the bottom ("imu6B x y z m10 r2/1": the three axes and the overall size
// in tenths of a g, raises seen, times the screen was brightened) and read the chip all the time, so a raise is counted even on a bright screen.
// This is ON while raise-to-wake is being tried out on the real board; set it to 0 once it works.
// The line shows on the normal screen only (not on the clock face), so while testing say "turn off the idle screen on my watch" first.
#ifndef NEDDY_RAISE_DEBUG
#define NEDDY_RAISE_DEBUG 0
#endif

static void outBlit(int x, int y, int w, int h, uint16_t *px) { gfx->draw16bitRGBBitmap(x, y, px, w, h); }
static void outFill(int x, int y, int w, int h, uint16_t colour) { gfx->fillRect(x, y, w, h, colour); }
static void clearScreen() { gfx->fillScreen(0); }

enum Mode { M_BOOT, M_WIFI, M_PAIR, M_LINK, M_READY, M_LISTEN, M_THINK, M_SPEAK, M_PROBLEM };
static Mode mode = M_BOOT;

static Preferences prefs;
static String deviceToken;
static String deviceName = "Neddy";
static String serverUrl;  // https://host
static String wifiSsid, wifiPass;   // the saved Wi-Fi (set up with the QR code)

static WebSocketsClient ws;
static bool wsUp = false;
// Battery saver (the person's setting, also the default): the Wi-Fi radio sleeps between messages and the processor runs at 160 MHz instead of 240.
// Neddy's first word may come a moment later. The server says it with the idle facts ("bs"); the watch also tells the server how it is doing (statusLoop).
#ifndef NEDDY_BATTERY_SAVER
#define NEDDY_BATTERY_SAVER 1
#endif
static bool batterySaver = NEDDY_BATTERY_SAVER != 0;
static int statPct = -1, statMv = 0, wsConnects = 0;
static bool statCharging = false, statUsb = false;
// The speaker amplifier (pin 46) draws current all the time it is on. With the battery saver on, it is switched on only while there is sound to play
// (and for 4 seconds after), instead of all day. Without the saver it stays on, as before.
static volatile unsigned long paOnUntil = 0;
static bool paState = false;
static void paTick(bool soundNow) {
  if (!PLAY_ANSWERS) return;
  unsigned long now = millis();
  if (!batterySaver) { if (!paState) { digitalWrite(46, HIGH); paState = true; } return; }
  if (soundNow) paOnUntil = now + 4000UL;
  bool want = soundNow || now < paOnUntil;
  if (want != paState) { digitalWrite(46, want ? HIGH : LOW); paState = want; }
}
static void applySaver(bool on) {
  batterySaver = on;
  WiFi.setSleep(on);                                // modem sleep between messages
  setCpuFrequencyMhz(on ? 160 : 240);
  LOGF("[power] battery saver %s (Wi-Fi sleep %d, %d MHz)\n", on ? "on" : "off", on ? 1 : 0, (int)getCpuFrequencyMhz());
}
static String wsHeader;
static unsigned long wsFailures = 0;

// Audio
static I2SClass i2s;
static StreamBufferHandle_t playBuffer;
static volatile bool flushPlayback = false;
static const int SAMPLE_RATE = 16000;

// What Neddy said (shown on screen), and how fast she answered.
static String saying;
static unsigned long lastSpeechDraw = 0;
static unsigned long releasedAt = 0;
static long lastAnswerMs = -1;
// What the last press sent (shown on screen, so a quiet or missing microphone is easy to see).
static long pressBytes = 0, pressPeak = 0, pressMisses = 0;
static String lastPress;
static String lastPress2;
static String lastPress3;
// Where the time goes between presses: the longest turn of the main loop, of the connection's own work,
// of the idle microphone read and of starting a press; and how long a press was held without starting.
static unsigned long maxLoop = 0, maxWs = 0, maxIdle = 0, maxStart = 0, loopPrev = 0, blockedMs = 0, blockedPrev = 0;
static unsigned long tSnd = 0, tMode = 0, tTrash = 0, maxCb = 0, lastRxAt = 0, quietAtPress = 0;
static String lastPress4;
static char blockedWhy = '-';  // L = link down, P = a problem screen was showing
// Why the board last started (power on, a crash, a watchdog, low power...) and how many starts since power-up.
static RTC_DATA_ATTR int bootCount = 0;
static String resetWhy;
static int wsDrops = 0;               // times the connection to Neddy dropped
static unsigned long wsDropAt = 0;     // when the last drop happened
static long wsBackMs = -1;             // how long the last reconnect took
static const char *resetName(int r) {
  switch (r) {
    case ESP_RST_POWERON: return "power on";
    case ESP_RST_SW: return "software restart";
    case ESP_RST_PANIC: return "CRASH";
    case ESP_RST_INT_WDT: return "watchdog (interrupt)";
    case ESP_RST_TASK_WDT: return "watchdog (task)";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "LOW POWER";
    case ESP_RST_DEEPSLEEP: return "deep sleep";
    case ESP_RST_EXT: return "reset pin";
    default: return "other";
  }
}
static unsigned long slowRead = 0, slowSend = 0;
static String micChip = "mic chip: not checked";
static bool waitingFirstSound = false;
static String problem;
static unsigned long problemUntil = 0;
static bool socketStarted = false;

// ---------------------------------------------------------------- tiny helpers
// The screen's built-in font only has plain letters: curly quotes and dashes become plain ones.
static String plain(const String &in) {
  String out;
  for (size_t i = 0; i < in.length(); i++) {
    uint8_t c = (uint8_t)in[i];
    if (c < 0x80) {
      out += (char)c;
    } else if (c == 0xE2 && i + 2 < in.length() && (uint8_t)in[i + 1] == 0x80) {
      uint8_t d = (uint8_t)in[i + 2];
      if (d == 0x98 || d == 0x99) out += '\'';
      else if (d == 0x9C || d == 0x9D) out += '"';
      else if (d == 0x93 || d == 0x94) out += '-';
      i += 2;
    } else {
      // Skip the rest of a multi-byte character.
      while (i + 1 < in.length() && ((uint8_t)in[i + 1] & 0xC0) == 0x80) i++;
    }
  }
  return out;
}

// Reads  "key":"value"  out of a small JSON text (no library needed for answers this simple).
static String jsonString(const String &body, const char *key) {
  String find = String("\"") + key + "\":\"";
  int at = body.indexOf(find);
  if (at < 0) return "";
  at += find.length();
  String out;
  while (at < (int)body.length()) {
    char c = body[at++];
    if (c == '\\' && at < (int)body.length()) {
      char n = body[at++];
      if (n == 'u' && at + 4 <= (int)body.length()) {
        long cp = strtol(body.substring(at, at + 4).c_str(), NULL, 16);
        at += 4;
        if (cp < 0x80) out += (char)cp;
        else if (cp == 0x2018 || cp == 0x2019) out += '\'';
        else if (cp == 0x201C || cp == 0x201D) out += '"';
        else if (cp == 0x2013 || cp == 0x2014) out += '-';
        else if (cp == 0x2026) out += "...";
        else if (cp == 0xA0) out += ' ';
      } else {
        out += (n == 'n') ? ' ' : n;
      }
    } else if (c == '"') {
      break;
    } else {
      out += c;
    }
  }
  return out;
}

// Reads  "key":123  (a whole number, maybe negative) out of a small JSON text; `none` when it isn't there.
// The power chip (AXP2101, I2C 0x34) knows the battery: status byte 0x00 (bit 3 = a battery is there), status 0x01 (bits 6:5 = 01 while charging)
// and the percent at 0xA4. Read once every 30 seconds; a failed read leaves the last answer alone.
static bool pmuByte(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(0x34);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)0x34, (uint8_t)1) != 1) return false;
  value = Wire.read();
  return true;
}
// The PWR side button (GPIO10, high while pressed): a short press opens or closes the menu. Holding it about 6 seconds still powers the board off.
// Between presses the microphone is read only this often (ms); 0 = every turn of the loop, as before.
#define IDLE_MIC_EVERY_MS 120
static void recPwr();   // (in the recorder section below)
static void pmuWrite(uint8_t reg, uint8_t value);   // (just below)
// What a short press of PWR does.
static void pwrShortPress() {
  if (uiRec.state != UI_RECS_OFF) recPwr();   // on a recording screen the button leaves it (never while recording or sending)
  else uiMenuOpen(millis());
}
// On some units the PWR button reaches only the power chip (AXP2101), not GPIO10. The chip keeps a note of each press in its second
// interrupt-status byte (0x49: bit 3 short press, bit 2 long press, bit 1 released, bit 0 pressed; writing a 1 clears a bit), once those
// are enabled in 0x41. Looked at every 40 ms. Returns true on a short press.
static bool pmuKeyShort() {
  static bool armed = false;
  static unsigned long last = 0;
  if (millis() - last < 40) return false;
  last = millis();
  uint8_t v = 0;
  if (!armed) {
    if (pmuByte(0x41, v)) {
      pmuWrite(0x41, v | 0x0F);
      armed = true;
      LOGLN("[pwr] power chip key watch on");
    }
    return false;
  }
  if (!pmuByte(0x49, v) || v == 0) return false;
  pmuWrite(0x49, v);
  LOGF("[pwr] power chip key status 0x%02X\n", v);
  return (v & 0x08) != 0;
}
static void pwrLoop() {
  static bool was = false;
  static unsigned long downAt = 0, changed = 0;
#if DEBUG_SERIAL
  static unsigned long beat = 0;
  if (millis() - beat > 5000) {   // proof that these messages reach the Serial Monitor
    beat = millis();
    LOGF("[dbg] alive, GPIO10=%d\n", digitalRead(10));
  }
#endif
  if (pmuKeyShort()) pwrShortPress();
  bool raw = digitalRead(10) == HIGH;
  if (raw != was && millis() - changed > 30) {
    LOGF("[pwr] GPIO10 is now %d\n", raw ? 1 : 0);
    changed = millis();
    if (raw) downAt = millis();
    else if (millis() - downAt < 1200) pwrShortPress();
    was = raw;
  }
}

static void pmuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(0x34);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}
// Reads the power chip (AXP2101) every 30 s (the first two looks come sooner): percent, charging, USB, battery volts. Without a battery
// reading the watch says so on screen, with the two raw status bytes, so a wrong register shows up at once.
static void batteryLoop() {
  static uint32_t last = 0;
  static int looks = 0;
  static bool adcOn = false;
  uint32_t now = millis();
  if (now < 3000UL) return;
  if (last != 0 && now - last < (looks < 3 ? 5000UL : 30000UL)) return;
  last = now;
  uint8_t v = 0;
  if (!adcOn) {                                          // switch on the chip's battery and USB voltage measuring, and battery detection
    if (pmuByte(0x30, v)) pmuWrite(0x30, v | 0x05);
    if (pmuByte(0x68, v)) pmuWrite(0x68, v | 0x01);
    adcOn = true;
    return;
  }
  uint8_t s1 = 0, s2 = 0, hi = 0, lo = 0, gauge = 0;
  if (!pmuByte(0x00, s1) || !pmuByte(0x01, s2)) return;
  looks++;
  bool vbus = (s1 & 0x20) != 0;
  int mv = 0;
  if (pmuByte(0x34, hi) && pmuByte(0x35, lo)) mv = ((hi & 0x3F) << 8) | lo;
  bool present = (s1 & 0x08) != 0 || (mv >= 2800 && mv <= 4600);
  int pct = -1;
  if (present) {
    if (pmuByte(0xA4, gauge) && gauge > 0 && gauge <= 100) pct = gauge;
    else if (mv >= 2800) pct = (mv - 3300) * 100 / 900 < 0 ? 0 : ((mv - 3300) * 100 / 900 > 100 ? 100 : (mv - 3300) * 100 / 900);
    else pct = 0;
  }
  int cs = s2 & 0x07;
  bool charging = present && ((((s2 >> 5) & 0x03) == 0x01) || (cs >= 1 && cs <= 4));
  LOGF("[batt] status0=0x%02X status1=0x%02X battery_mV=%d present=%d percent=%d charging=%d usb=%d\n", s1, s2, mv, present ? 1 : 0, pct, charging ? 1 : 0, vbus ? 1 : 0);
  statPct = pct; statMv = mv; statCharging = charging; statUsb = vbus;
  uiSetBattery(pct, charging, s1, s2, mv, vbus);
}

// Tells the server how the watch is doing (battery, power source, Wi-Fi strength, how long it has been on, how often it reconnected, whether the saver is on):
// about 30 s after it connects, then every 5 minutes. Small, and only while the connection to Neddy is up. The server keeps the last one and logs each.
static void statusLoop() {
  static unsigned long lastSent = 0;
  static bool first = true;
  if (!wsUp) { first = true; return; }
  unsigned long now = millis();
  if (lastSent == 0) lastSent = now;
  if (now - lastSent < (first ? 30000UL : 300000UL)) return;
  lastSent = now; first = false;
  String m = String("{\"type\":\"device.status\"");
  if (statPct >= 0) m += String(",\"battery\":") + statPct;
  if (statMv > 0) m += String(",\"mv\":") + statMv;
  m += String(",\"charging\":") + (statCharging ? 1 : 0) + ",\"usb\":" + (statUsb ? 1 : 0);
  m += String(",\"rssi\":") + (int)WiFi.RSSI() + ",\"up\":" + (now / 1000) + ",\"connects\":" + wsConnects + ",\"saver\":" + (batterySaver ? 1 : 0) + "}";
  ws.sendTXT(m.c_str());
}

// ---------------------------------------------------------------- the motion chip, for raise-to-wake
// The board has a QMI8658 (accelerometer + gyroscope) on the same I2C bus, normally at 0x6B. Only the accelerometer is used, and only while the
// person has raise-to-wake turned on (the setting arrives with the idle facts; off, the chip is stopped). The registers below come from the chip's
// datasheet and were NOT yet checked on the real board when this was written, so: the chip's ID is checked first, the byte order is checked against
// gravity, and a test build (NEDDY_RAISE_DEBUG 1) shows what the chip reads on the first line at the bottom. With the watch lying flat on a table the axis that
// points through the screen must read +10 or -10 (which sign doesn't matter: the detector ignores it) and m (the overall size) must read about 10.
// If another axis reads 10 instead of z, set NEDDY_IMU_UP_AXIS (0 = x, 1 = y, 2 = z). See neddy_raise.h for the rule.
#ifndef NEDDY_IMU_UP_AXIS
#define NEDDY_IMU_UP_AXIS 2
#endif
static uint8_t imuAddr = 0;
static bool imuOn = false, imuBig = false;       // the chip is measuring; its bytes come high byte first
static RaiseDetector raiseDet;

static bool imuReadAt(uint8_t addr, uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}
static bool imuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}
// Three axes in milli-g (1000 = 1 g). The chip counts 16384 per g in its +-2 g range. All zeros means it has no reading yet.
static bool imuSample(int g[3], bool big) {
  uint8_t b[6];
  if (!imuReadAt(imuAddr, 0x35, b, 6)) return false;
  if ((b[0] | b[1] | b[2] | b[3] | b[4] | b[5]) == 0) return false;
  for (int i = 0; i < 3; i++) {
    uint16_t raw = big ? (uint16_t)((b[2 * i] << 8) | b[2 * i + 1]) : (uint16_t)(b[2 * i] | (b[2 * i + 1] << 8));
    g[i] = (int)((int16_t)raw) * 1000L / 16384;
  }
  return true;
}
// Finds the chip, sets the accelerometer going (+-2 g, 125 readings a second) and settles the byte order by which reading adds up to about 1 g.
static bool imuStart() {
  static const uint8_t addrs[2] = { 0x6B, 0x6A };
  imuAddr = 0;
  for (int i = 0; i < 2 && !imuAddr; i++) {
    uint8_t id = 0;
    if (imuReadAt(addrs[i], 0x00, &id, 1) && id == 0x05) imuAddr = addrs[i];   // WHO_AM_I
  }
  if (!imuAddr) return false;
  imuWrite(0x60, 0xB0);   // reset
  delay(30);
  imuWrite(0x02, 0x40);   // CTRL1: step through the registers on a block read, low byte first
  imuWrite(0x03, 0x06);   // CTRL2: accelerometer +-2 g, 125 readings a second
  imuWrite(0x08, 0x01);   // CTRL7: accelerometer on, gyroscope off
  long little = 0, bigger = 0; int got = 0;
  for (int tries = 0; tries < 12 && got < 5; tries++) {
    delay(12);
    int a[3], b[3];
    if (!imuSample(a, false) || !imuSample(b, true)) continue;
    little += labs(raiseMag(a[0], a[1], a[2]) - 1000);
    bigger += labs(raiseMag(b[0], b[1], b[2]) - 1000);
    got++;
  }
  imuBig = got > 0 && bigger < little;
  imuOn = true;
  LOGF("[imu] QMI8658 at 0x%02X, %s byte order (off from 1 g: %ld vs %ld over %d looks)\n", imuAddr, imuBig ? "high-first" : "low-first", little, bigger, got);
  return true;
}
// Called every turn of the loop. Reads the chip about 30 times a second, and only while something is dimmed (a bright screen has nothing to wake),
// or all the time in a test build (NEDDY_RAISE_DEBUG 1) so the readout and the raise count are live.
static void raiseLoop() {
  static uint32_t lastPoll = 0, retryAt = 0, lastNote = 0, lastGood = 0;
  static bool wasNeeded = false;
  static int seen = 0, g[3] = { 0, 0, 0 };
  uint32_t now = millis();
  if (!uiIdle.raise) {                                            // switched off: the chip stops measuring
    if (imuOn) { imuWrite(0x08, 0x00); imuOn = false; wasNeeded = false; }
    if (NEDDY_RAISE_DEBUG) snprintf(uiImuDbg, sizeof(uiImuDbg), "raise to wake: off");
    return;
  }
  if (!imuOn) {
    if (now < retryAt) return;
    if (!imuStart()) {
      retryAt = now + 30000UL;
      if (NEDDY_RAISE_DEBUG) snprintf(uiImuDbg, sizeof(uiImuDbg), "motion chip: not found");
      return;
    }
    lastGood = now;
  }
  if (!(uiWantsRaise() || NEDDY_RAISE_DEBUG != 0)) { wasNeeded = false; return; }
  if (!wasNeeded) { raiseReset(raiseDet); wasNeeded = true; }
  if (now - lastPoll >= 33) {
    lastPoll = now;
    if (imuSample(g, imuBig)) {
      lastGood = now;
#if DEBUG_SERIAL
      {                                                           // every real movement, as it happens (readings in thousandths of a g)
        static int pg[3] = { 0, 0, 0 };
        static uint32_t lastMove = 0;
        int d = (g[0] > pg[0] ? g[0] - pg[0] : pg[0] - g[0]) + (g[1] > pg[1] ? g[1] - pg[1] : pg[1] - g[1]) + (g[2] > pg[2] ? g[2] - pg[2] : pg[2] - g[2]);
        if (d > 250 && now - lastMove >= 150) { lastMove = now; LOGF("[raise] moving: x=%d y=%d z=%d mg, screen dimmed=%d\n", g[0], g[1], g[2], uiDimmed ? 1 : 0); }
        pg[0] = g[0]; pg[1] = g[1]; pg[2] = g[2];
      }
#endif
      if (raiseFeed(raiseDet, now, g[NEDDY_IMU_UP_AXIS], raiseMag(g[0], g[1], g[2]))) { seen++; LOGF("[raise] a raise was seen (screen dimmed: %d)\n", uiDimmed ? 1 : 0); uiRaise(now); }
    }
  }
#if DEBUG_SERIAL
  static uint32_t lastLog = 0;
  if (now - lastLog >= 1000) {                                    // once a second: is it on, is the chip answering, what does it read, is the screen dimmed
    lastLog = now;
    LOGF("[raise] setting=%d chip=%d dimmed=%d g=%d,%d,%d (tenths of a g /10) seen=%d brightened=%d\n", uiIdle.raise ? 1 : 0, imuOn ? 1 : 0, uiDimmed ? 1 : 0,
         g[0] / 100, g[1] / 100, g[2] / 100, seen, uiRaises);
  }
#endif
  if (NEDDY_RAISE_DEBUG && now - lastNote >= 400) {
    lastNote = now;
    if (now - lastGood > 1500) snprintf(uiImuDbg, sizeof(uiImuDbg), "imu%02X: no readings", imuAddr);
    else snprintf(uiImuDbg, sizeof(uiImuDbg), "imu%02X x%+d y%+d z%+d m%d r%d/%d", imuAddr, g[0] / 100, g[1] / 100, g[2] / 100, raiseMag(g[0], g[1], g[2]) / 100, seen, uiRaises);
    uiDiagDirty = true;
  }
}

static int jsonInt(const String &body, const char *key, int none) {
  String find = String("\"") + key + "\":";
  int at = body.indexOf(find);
  if (at < 0) return none;
  at += find.length();
  int end = at;
  if (end < (int)body.length() && body[end] == '-') end++;
  while (end < (int)body.length() && body[end] >= '0' && body[end] <= '9') end++;
  if (end == at || (end == at + 1 && body[at] == '-')) return none;
  return body.substring(at, end).toInt();
}

static String httpPost(const String &path, const String &body, int &status) {
  WiFiClientSecure client;
  client.setInsecure();  // Early testing: the connection is encrypted but the server's identity isn't checked yet.
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, serverUrl + path)) {
    status = -1;
    return "";
  }
  http.addHeader("Content-Type", "application/json");
  status = http.POST(body);
  String answer = status > 0 ? http.getString() : String("");
  http.end();
  return answer;
}

// ---------------------------------------------------------------- screens
static bool uiActive = false;   // true while Neddy's own screen (neddy_ui.h) owns the display
static String heard;            // what Neddy understood you said (small, grey)
static unsigned long dLoop = 0, dWs = 0, dIdle = 0, dStart = 0, lastDiag = 0;
static long dSentMs = 0, dPeak = 0;

static void screenBoot(const String &line) {
  uiActive = false;
  clearScreen();
  uiTextCentered(NFONT_TITLE, 160, "Neddy", UI_TEAL);
  uiTextCentered(NFONT_BODY, 300, line.c_str(), UI_GREY);
  uiTextCentered(NFONT_MID, 450, (String("version ") + FIRMWARE_VERSION).c_str(), UI_GREY);
}

static void screenProblem(const String &title, const String &detail) {
  uiActive = false;
  clearScreen();
  uiTextCentered(NFONT_TITLE, 100, title.c_str(), UI_AMBER);
  uiParagraph(NFONT_BODY, 170, detail.c_str(), UI_WHITE, 340, 11, 26);
  if (uiRec.state != UI_RECS_OFF) uiRec.full = true;   // a recording screen was under this: draw it again afterwards
}

static void screenPair(const String &code, int secondsLeft) {
  uiActive = false;
  clearScreen();
  uiTextCentered(NFONT_TITLE, 50, "Pair me with Neddy", UI_WHITE);
  String shown = code.substring(0, 3) + " " + code.substring(3);
  uiTextCentered(NFONT_HUGE, 110, shown.c_str(), UI_TEAL);
  uiParagraph(NFONT_BODY, 220, "On your phone open Neddy, then You > Account > Your devices, and type this code. Or say to Neddy: pair my device.",
              UI_WHITE, 340, 8, 26);
  char buf[32];
  snprintf(buf, sizeof(buf), "Works for %d:%02d", secondsLeft / 60, secondsLeft % 60);
  uiTextCentered(NFONT_MID, 440, buf, UI_GREY);
}

// The two small lines at the bottom: link, microphone, and how the last press went.
static void buildDiag() {
  char a[96], b[110];
  snprintf(a, sizeof(a), "Wi-Fi %d dBm  %s  drops %d  %s", (int)WiFi.RSSI(), micChip.c_str(), wsDrops, resetWhy.c_str());
  if (lastAnswerMs >= 0)
    snprintf(b, sizeof(b), "answer %.1f s  sent %ld ms  peak %ld  L%lu W%lu M%lu S%lu", lastAnswerMs / 1000.0, dSentMs, dPeak, dLoop, dWs, dIdle, dStart);
  else
    snprintf(b, sizeof(b), "sent %ld ms  peak %ld  L%lu W%lu M%lu S%lu", dSentMs, dPeak, dLoop, dWs, dIdle, dStart);
  uiSetDiag(a, b);
}

static void uiSync() {
  buildDiag();
  uiSetName(deviceName.c_str());
  uiSetWords(saying.c_str());
  uiSetHeard(heard.c_str());
}

static void screenState() {
  switch (mode) {
    case M_WIFI:
      if (uiRec.state != UI_RECS_OFF) break;   // a recording screen is up: Wi-Fi comes back quietly behind it
      uiActive = false;
      uiClearCard();
      clearScreen();
      uiTextCentered(NFONT_TITLE, 150, "Joining Wi-Fi", UI_WHITE);
      { char nm[48]; uiFit(nm, sizeof(nm), NFONT_BODY, wifiSsid.c_str(), 360); uiTextCentered(NFONT_BODY, 230, nm, UI_GREY); }
      break;
    case M_LINK:
    case M_READY:
    case M_LISTEN:
    case M_THINK:
    case M_SPEAK: {
      if (!uiActive) {
        uiActive = true;
        uiAll = true;
      }
      uiSetMode(mode == M_LINK ? UI_LINK : mode == M_LISTEN ? UI_LISTEN : mode == M_THINK ? UI_THINK : mode == M_SPEAK ? UI_SPEAK : UI_READY);
      uiSync();
      break;
    }
    default:
      if (uiRec.state != UI_RECS_OFF) break;
      uiActive = false;
      uiClearCard();
      clearScreen();
      break;
  }
}

// (An int, not Mode: the Arduino IDE writes a list of function names above the file's first line, before
// Mode exists, and a function using Mode there doesn't compile.)
static void setMode(int next) {
  if ((int)mode == next) return;
  mode = (Mode)next;
  LOGF("[mode] %d\n", (int)next);
  screenState();
}

// ---------------------------------------------------------------- audio
static es8311_handle_t codecHandle = NULL;
static unsigned long volLocalAt = 0;   // when the person last changed the volume on the watch (a slower echo from the server is ignored for a few seconds)
static int speakerVolume = SPEAKER_VOLUME;   // 0 to 100; Neddy's server sends the person's choice ("vol") with the idle facts
// Sets the speaker volume (only if the audio chip is up and the number changed). Called from the loop's own turn, like the other I2C reads.
static void applyVolume(int v) {
  if (v < 0) v = 0;
  if (v > 100) v = 100;
  uiVolume = v;                                     // what the menu's volume screen shows
  if (v == speakerVolume) return;
  speakerVolume = v;
  if (codecHandle) {
    esp_err_t e = es8311_voice_volume_set(codecHandle, v, NULL);
    LOGF("[audio] volume %d (%s)\n", v, e == ESP_OK ? "ok" : "failed");
  }
}
static esp_err_t codecInit() {
  es8311_handle_t handle = es8311_create(0, ES8311_ADDRRES_0);
  ESP_RETURN_ON_FALSE(handle, ESP_FAIL, "codec", "es8311 create failed");
  codecHandle = handle;
  const es8311_clock_config_t clk = {
    .mclk_inverted = false,
    .sclk_inverted = false,
    .mclk_from_mclk_pin = true,
    .mclk_frequency = SAMPLE_RATE * 256,
    .sample_frequency = SAMPLE_RATE
  };
  ESP_ERROR_CHECK(es8311_init(handle, &clk, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16));
  ESP_RETURN_ON_ERROR(es8311_sample_frequency_config(handle, clk.mclk_frequency, clk.sample_frequency),
                      "codec", "sample rate failed");
  ESP_RETURN_ON_ERROR(es8311_microphone_config(handle, false), "codec", "microphone failed");
  ESP_RETURN_ON_ERROR(es8311_voice_volume_set(handle, speakerVolume, NULL), "codec", "volume failed");
  ESP_RETURN_ON_ERROR(es8311_microphone_gain_set(handle, (es8311_mic_gain_t)MIC_GAIN), "codec",
                      "microphone gain failed");
  return ESP_OK;
}

// ---------------------------------------------------------------- the microphone chip
// This board's microphones go through a separate chip (an ES7210), not through the speaker chip.
// It must be told to start, or it sends nothing but zeros. The steps below follow Espressif's own
// driver for that chip (16 kHz, 16-bit, standard I2S, clock from the board's 4.096 MHz MCLK).
static bool es7210Write(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool es7210Init() {
  uint8_t addr = 0;
  for (uint8_t a = 0x40; a <= 0x43; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      addr = a;
      break;
    }
  }
  if (!addr) {
    micChip = "mic chip: NOT FOUND";
    LOGLN("[mic] no ES7210 answered at 0x40-0x43");
    return false;
  }
  int bad = 0;
  auto w = [&](uint8_t reg, uint8_t val) {
    if (!es7210Write(addr, reg, val)) bad++;
  };
  w(0x00, 0xFF);  // reset
  w(0x00, 0x32);
  delay(10);
  w(0x09, 0x30);  // power-up timing
  w(0x0A, 0x30);
  w(0x23, 0x2A);  // high-pass filters
  w(0x22, 0x0A);
  w(0x21, 0x2A);
  w(0x20, 0x0A);
  w(0x11, 0x60);  // 16-bit, standard I2S
  w(0x12, 0x00);  // no TDM
  w(0x40, 0xC3);  // analog power
  w(0x41, 0x70);  // microphone bias
  w(0x42, 0x70);
  const uint8_t gain = 0x10 | 10;  // 30 dB
  w(0x43, gain);
  w(0x44, gain);
  w(0x45, gain);
  w(0x46, gain);
  w(0x47, 0x08);  // power on the four microphone inputs
  w(0x48, 0x08);
  w(0x49, 0x08);
  w(0x4A, 0x08);
  w(0x07, 0x20);  // 16 kHz from a 4.096 MHz clock
  w(0x02, 0xC1);
  w(0x04, 0x01);
  w(0x05, 0x00);
  w(0x06, 0x04);
  w(0x4B, 0x0F);
  w(0x4C, 0x0F);
  w(0x00, 0x71);  // start
  w(0x00, 0x41);
  char note[48];
  snprintf(note, sizeof(note), "mic chip 0x%02X %s", addr, bad ? "setup errors" : "ok");
  micChip = note;
  LOGF("[mic] ES7210 at 0x%02X, %d failed writes\n", addr, bad);
  return bad == 0;
}

static bool audioInit() {
  i2s.setPins(41, 45, 40, 42, 16);  // mclk, bclk, ws, data out, data in (Waveshare's example)
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    LOGLN("[audio] I2S failed to start");
    return false;
  }
  i2s.setTimeout(100);  // a read that finds no sound gives up quickly instead of freezing everything
  Wire.begin(IIC_SDA, IIC_SCL);
#if DEBUG_SERIAL
  // Which chips answer on the I2C bus (for finding out what a board really has): printed once.
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) LOGF("[i2c] a chip answers at 0x%02X\n", a);
  }
#endif
  pinMode(46, OUTPUT);
  digitalWrite(46, (PLAY_ANSWERS && !batterySaver) ? HIGH : LOW);  // speaker amplifier (with the saver on it wakes when there is sound: see paTick)
  paState = PLAY_ANSWERS && !batterySaver;
  if (codecInit() != ESP_OK) {
    LOGLN("[audio] audio chip setup failed");
    return false;
  }
  es7210Init();  // the microphone chip; a problem is shown on screen, not fatal
  playBuffer = xStreamBufferCreate(48 * 1024, 2);
  return playBuffer != NULL;
}

// A short note (about a tenth of a second) so the person hears the new volume when they change it on the watch.
static void playBeep() {
#if PLAY_ANSWERS
  if (!playBuffer) return;
  static int16_t tone[320];
  for (int part = 0; part < 6; part++) {            // 6 pieces of 20 ms of a 660 Hz note, faded in and out
    for (int i = 0; i < 320; i++) {
      int n = part * 320 + i;
      float env = n < 160 ? n / 160.0f : (n > 1760 ? (1920 - n) / 160.0f : 1.0f);
      tone[i] = (int16_t)(sinf(2.0f * 3.14159265f * 660.0f * n / (float)SAMPLE_RATE) * 9000.0f * env);
    }
    xStreamBufferSend(playBuffer, tone, sizeof(tone), 0);
  }
#endif
}

// Plays what the server sends (mono 16 kHz) on both speaker channels, and keeps the speaker fed with
// silence in between so it never repeats old sound.
static void playTask(void *) {
  static int16_t mono[320];
  static int16_t stereo[640];
  static uint8_t scratch[512];
  uint8_t carry = 0;
  bool haveCarry = false;
  for (;;) {
    if (flushPlayback) {
      flushPlayback = false;
      haveCarry = false;
      while (xStreamBufferReceive(playBuffer, scratch, sizeof(scratch), 0) > 0) {
      }
      continue;
    }
    uint8_t *into = (uint8_t *)mono;
    size_t room = sizeof(mono);
    size_t got = 0;
    if (haveCarry) {
      into[0] = carry;
      haveCarry = false;
      got = 1;
    }
    got += xStreamBufferReceive(playBuffer, into + got, room - got, pdMS_TO_TICKS(10));
    paTick(got > 0);
    if (got == 0) {
      memset(stereo, 0, 160 * 4);
      i2s.write((uint8_t *)stereo, 160 * 4);  // 10 ms of silence
      continue;
    }
    if (got & 1) {
      carry = into[got - 1];
      haveCarry = true;
      got--;
    }
    size_t samples = got / 2;
    for (size_t i = 0; i < samples; i++) {
      int16_t v = PLAY_ANSWERS ? mono[i] : 0;  // words only: the same amount of data goes out, but silent
      stereo[2 * i] = v;
      stereo[2 * i + 1] = v;
    }
    i2s.write((uint8_t *)stereo, samples * 4);
  }
}

// ---------------------------------------------------------------- the button
static const int BUTTON = 0;  // BOOT: low while pressed
static bool held = false;
static unsigned long pressStart = 0;
static unsigned long lastLevelDraw = 0;

static bool buttonDown() {
  static bool last = false;
  static unsigned long changed = 0;
  bool raw = digitalRead(BUTTON) == LOW;
  if (raw != last && millis() - changed > 30) {
    last = raw;
    changed = millis();
  }
  return last;
}


// ---------------------------------------------------------------- touch
// The FT3168 touch chip shares the I2C wires with the audio chips (address 0x38, reset on GPIO 9). It is read
// about every 16 ms; neddy_ui.h turns what it reports into taps, holds, double taps and swipes.
//
// 1 = draw a dot under the finger while it touches (to check the touch lines up with the picture; the screen
// is drawn again when the finger lifts). 0 = no dots.
#ifndef TOUCH_TRAIL
#define TOUCH_TRAIL 0
#endif
// If the dot is NOT under the finger, these three turn the touch around (try one at a time).
#ifndef TOUCH_SWAP_XY
#define TOUCH_SWAP_XY 0
#endif
#ifndef TOUCH_FLIP_X
#define TOUCH_FLIP_X 0
#endif
#ifndef TOUCH_FLIP_Y
#define TOUCH_FLIP_Y 0
#endif
static const int TP_RESET_PIN = 9;
static const uint8_t TP_ADDR = 0x38;
static bool touchOk = false;
static bool touchWasDown = false;
static unsigned long touchAt = 0;

static void touchInit() {
  pinMode(TP_RESET_PIN, OUTPUT);
  digitalWrite(TP_RESET_PIN, HIGH);
  delay(2);
  digitalWrite(TP_RESET_PIN, LOW);
  delay(20);
  digitalWrite(TP_RESET_PIN, HIGH);
  delay(60);
  Wire.beginTransmission(TP_ADDR);
  Wire.write(0xA5);  // power mode
  Wire.write(0x00);  // active
  touchOk = Wire.endTransmission() == 0;
  Wire.setClock(400000);
  LOGF("[touch] %s\n", touchOk ? "ready" : "the touch chip didn't answer");
}

// 1 = a finger (x, y set), 0 = none, -1 = couldn't read this time.
static int touchRead(int *x, int *y) {
  Wire.beginTransmission(TP_ADDR);
  Wire.write(0x02);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((int)TP_ADDR, 5) != 5) return -1;
  int fingers = Wire.read() & 0x0F;
  int xh = Wire.read(), xl = Wire.read(), yh = Wire.read(), yl = Wire.read();
  if (fingers == 0 || fingers > 2) return 0;
  int px = ((xh & 0x0F) << 8) | xl, py = ((yh & 0x0F) << 8) | yl;
  if (TOUCH_SWAP_XY) { int t = px; px = py; py = t; }
  if (px >= UI_W) px = UI_W - 1;
  if (py >= UI_H) py = UI_H - 1;
  if (TOUCH_FLIP_X) px = UI_W - 1 - px;
  if (TOUCH_FLIP_Y) py = UI_H - 1 - py;
  *x = px;
  *y = py;
  return 1;
}

// Called every turn of the loop: reads the chip now and then and passes it on.
static void touchLoop() {
  if (!touchOk || !uiActive || millis() - touchAt < 16) return;
  touchAt = millis();
  int x = 0, y = 0;
  int r = touchRead(&x, &y);
  if (r < 0) return;  // a read that failed changes nothing
  static int lastX = 0, lastY = 0;
  if (r == 1) { lastX = x; lastY = y; } else { x = lastX; y = lastY; }   // a lifted finger has no position: hand over where it last was
  uiTouch(millis(), r == 1, x, y);
  if (TOUCH_TRAIL) {
    if (r == 1) {
      int bx = (x & ~1) - 6, by = (y & ~1) - 6;
      if (bx < 0) bx = 0;
      if (by < 0) by = 0;
      if (bx > UI_W - 12) bx = UI_W - 12;
      if (by > UI_H - 12) by = UI_H - 12;
      uiOut.fill(bx & ~1, by & ~1, 12, 12, UI_CORAL);
    } else if (touchWasDown) {
      uiAll = true;  // the finger lifted: draw the screen again, without the dots
    }
  }
  touchWasDown = (r == 1);
}

static void startTalking() {
  if (!wsUp) return;
  held = true;
  pressStart = millis();
  saying = "";
  heard = "";
  waitingFirstSound = false;
  pressBytes = 0;
  pressPeak = 0;
  pressMisses = 0;
  slowRead = 0;
  slowSend = 0;
  // Sound still playing from a last answer is cut off, as when you talk over someone.
  flushPlayback = true;
  quietAtPress = millis() - lastRxAt;  // how long since anything came from Neddy
  unsigned long a = millis();
  ws.sendTXT("{\"type\":\"ptt.start\"}");
  unsigned long b = millis();
  setMode(M_LISTEN);
  unsigned long c = millis();
  // Throw away what the microphone heard before the press.
  static uint8_t trash[1280];
  for (int i = 0; i < 2; i++) i2s.readBytes((char *)trash, sizeof(trash));  // about 40 ms of old sound
  unsigned long d = millis();
  tSnd = b - a;
  tMode = c - b;
  tTrash = d - c;
  LOGLN("[talk] start");
}

static void stopTalking() {
  if (!held) return;
  held = false;
  uiTouchTalkEnded();  // a touch hold or hands-free talk lets go too
  ws.sendTXT("{\"type\":\"ptt.end\"}");
  releasedAt = millis();
  {
    char note[64];
    snprintf(note, sizeof(note), "sent %ld ms peak %ld gaps %ld", pressBytes / 32, pressPeak, pressMisses);
    lastPress = note;
    char note2[64];
    snprintf(note2, sizeof(note2), "slowest read %lu ms, send %lu ms", slowRead, slowSend);
    lastPress2 = note2;
    char note3[64];
    snprintf(note3, sizeof(note3), "L%lu W%lu M%lu S%lu H%lu%c", maxLoop, maxWs, maxIdle, maxStart,
             blockedMs, blockedWhy);
    lastPress3 = note3;
    char note4[64];
    snprintf(note4, sizeof(note4), "snd%lu mode%lu trash%lu cb%lu q%lu", tSnd, tMode, tTrash, maxCb, quietAtPress / 1000);
    lastPress4 = note4;
    tSnd = tMode = tTrash = maxCb = 0;
    dLoop = maxLoop; dWs = maxWs; dIdle = maxIdle; dStart = maxStart; dSentMs = pressBytes / 32; dPeak = pressPeak;
    maxLoop = maxWs = maxIdle = maxStart = blockedMs = blockedPrev = 0;
    blockedWhy = '-';
    LOGF("[talk] %s, %s, %s, %s\n", note, note2, note3, note4);
  }
  waitingFirstSound = true;
  setMode(M_THINK);
  LOGLN("[talk] end");
}

// Reads 20 ms of microphone sound, makes it mono (takes the louder of the two channels), sends it.
static void sendMicChunk() {
  static int16_t stereo[640];  // 320 frames of 2 x 16-bit = 20 ms
  static int16_t mono[320];
  unsigned long t0 = millis();
  size_t got = i2s.readBytes((char *)stereo, sizeof(stereo));
  if (millis() - t0 > slowRead) slowRead = millis() - t0;
  size_t frames = got / 4;
  if (frames == 0) {
    pressMisses++;
    return;
  }
  long peak = 0;
  for (size_t i = 0; i < frames; i++) {
    int16_t l = stereo[2 * i], r = stereo[2 * i + 1];
    int16_t pick = (abs((int)l) >= abs((int)r)) ? l : r;
    mono[i] = pick;
    if (abs((int)pick) > peak) peak = abs((int)pick);
  }
  unsigned long t1 = millis();
  ws.sendBIN((uint8_t *)mono, frames * 2);
  if (millis() - t1 > slowSend) slowSend = millis() - t1;
  pressBytes += frames * 2;
  if (peak > pressPeak) pressPeak = peak;
  if (millis() - lastLevelDraw > 100) {
    lastLevelDraw = millis();
    uiSetLevel(sqrtf((float)peak / 20000.0f));
  }
}

// Between presses the microphone is still read (and thrown away), so its buffer never overflows, and
// the ready screen shows a live bar. Nothing is sent to Neddy.
static unsigned long lastIdleDraw = 0;
static void idleMic() {
  static int16_t stereo[640];
  size_t got = i2s.readBytes((char *)stereo, sizeof(stereo));
  size_t frames = got / 4;
  if (frames == 0) return;
  long peak = 0;
  for (size_t i = 0; i < frames * 2; i++) {
    long v = abs((int)stereo[i]);
    if (v > peak) peak = v;
  }
}

// ---------------------------------------------------------------- the recorder
// Record from the menu: the microphone's sound is squeezed (neddy_rec.h) and written straight into the flash partition "rec" as it
// is heard, so nothing is only in memory. Wi-Fi is off while it records (battery). After Stop the watch joins Wi-Fi again and sends the
// recording to the server in 64 KB pieces (PUT /api/device/recording/<id>); the server writes it up as a meeting in the Muse app. The
// copy on the watch is only marked "sent" once the server says it has everything, and a recording found at start-up (power lost, or
// no Wi-Fi at the time) is sent when the watch is next idle.
#include "esp_partition.h"
#include "neddy_rec.h"

enum { RS_IDLE, RS_REC, RS_SEND, RS_FAIL };
static int recState = RS_IDLE;
static Rec rec;
static RecIO recIO;
static RecFound recFound;
static const esp_partition_t *recPart = nullptr;
static uint32_t recSent = 0;                 // bytes of slots the server has confirmed
static bool recStatusKnown = false;
static int recFailures = 0, recLastPct = -1;
static unsigned long recNextTry = 0, recAutoAt = 0, recWorstOp = 0, recGaps = 0;
static uint32_t recLastSecond = 0xFFFFFFFFu;
static bool recSendShown = false;           // the "Please wait" sending screen has been drawn since the send began

static bool rpErase(uint32_t off, uint32_t len) { return recPart && esp_partition_erase_range(recPart, off, len) == ESP_OK; }
static bool rpWrite(uint32_t off, const uint8_t *d, uint32_t len) { return recPart && esp_partition_write(recPart, off, d, len) == ESP_OK; }
static bool rpRead(uint32_t off, uint8_t *d, uint32_t len) { return recPart && esp_partition_read(recPart, off, d, len) == ESP_OK; }

static bool recPending() { return recPart && recFound.present && !recFound.sent && recFound.slots > 0; }
static void recMinutesText(char *dst, size_t cap, uint32_t ms) { unsigned m = (unsigned)((ms + 59999UL) / 60000UL); snprintf(dst, cap, "%u %s", m, m == 1 ? "minute" : "minutes"); }
static void recRefreshSub() {
  if (recPending()) { snprintf(uiRecSub, sizeof(uiRecSub), "Waiting to send"); return; }
  uint32_t s = recPart ? recCapacitySeconds(recIO) : 0;
  snprintf(uiRecSub, sizeof(uiRecSub), "Up to %u h %02u", (unsigned)(s / 3600), (unsigned)((s % 3600) / 60));
}
static void recInit() {
  recPart = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "rec");
  uiRecAvailable = recPart != nullptr;
  if (!recPart) { LOGLN("[rec] no 'rec' partition: choose Flash Size 32MB and keep partitions.csv in the sketch folder"); return; }
  recIO = RecIO{ rpErase, rpWrite, rpRead, recPart->size };
  recFound = recLook(recIO);
  LOGF("[rec] partition %u bytes, found: present %d sent %d slots %u\n", (unsigned)recPart->size, recFound.present, recFound.sent, (unsigned)recFound.slots);
  recRefreshSub();
  if (recPending()) recAutoAt = millis() + 20000UL;   // a recording was left behind: it is sent once the watch is up and idle
}

// The "sending" screen. It is drawn at once (uiTick), because what comes next (joining Wi-Fi, a piece going up, the server finishing the last one) can take
// seconds to a minute or more with the screen unable to redraw: without this it sat on the old screen and looked frozen.
static void recShowSending(const char *small) {
  char big[16]; recMinutesText(big, sizeof(big), recFound.ms);
  uiRecInfo(millis(), "Sending to your phone", big, small, recLastPct < 0 ? 0 : recLastPct, "");
  uiTick(millis());
}
static void recShowSendingPct() {
  char t[32];
  if (recLastPct > 0) snprintf(t, sizeof(t), "Please wait... %d%%", recLastPct); else snprintf(t, sizeof(t), "Please wait...");
  recShowSending(t);
}
static void recBeginSend() {
  ws.disconnect(); wsUp = false; socketStarted = false;   // one secure connection at a time: the one to Neddy would use up the memory the upload needs
  recState = RS_SEND; recSent = 0; recStatusKnown = false; recFailures = 0; recNextTry = 0; recLastPct = 0;
  recSendShown = false;
  recShowSendingPct();
}
static void recShowWaiting() {
  char big[16]; recMinutesText(big, sizeof(big), recFound.ms);
  uiRecInfo(millis(), "A recording is waiting", big, "Send it before a new one", -1, "Send now");
}

static void recBegin() {
  if (!recPart || recState != RS_IDLE) return;
  if (held) stopTalking();
  if (recPending()) { recShowWaiting(); return; }
  if (!uiIdle.have) { uiRecInfo(millis(), "Not ready yet", "", "Waiting for the time.", -1, "OK"); return; }
  uint32_t utc = uiIdle.baseUtc + (millis() - uiIdle.baseMs) / 1000;
  if (!recStart(rec, recIO, (uint32_t)esp_random(), utc)) {
    uiRecInfo(millis(), "Can't record", "", "The storage didn't answer.", -1, "OK");
    return;
  }
  ws.disconnect(); wsUp = false; socketStarted = false;
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);        // no radio while recording: the battery lasts, and nothing competes for the flash
  flushPlayback = true;
  recState = RS_REC; recLastSecond = 0xFFFFFFFFu; recWorstOp = 0; recGaps = 0;
  uiRecRun(millis(), 0, recSecondsLeft(rec), 0);
  LOGLN("[rec] started");
}

static void recFinish(const char *why) {
  bool ok = recStop(rec);
  recFound = recLook(recIO);
  LOGF("[rec] stopped (%s): slots %u skipped %u ms %u ok %d worst op %lu ms, gaps %lu\n", why, (unsigned)rec.slots, (unsigned)rec.skipped, (unsigned)recFound.ms, ok, recWorstOp, recGaps);
  recRefreshSub();
  if (!recPending()) {                                // nothing was said: nothing to send
    if (recFound.present && !recFound.sent) recMarkSent(recIO);
    recFound = recLook(recIO);
    recState = RS_IDLE;
    uiRecInfo(millis(), "Nothing recorded", "", "It was all quiet.", -1, "OK");
    return;
  }
  recLastPct = 0; recSent = 0; recStatusKnown = false; recFailures = 0; recNextTry = 0;
  recState = RS_SEND;
  char big[16]; recMinutesText(big, sizeof(big), recFound.ms);
  const char *title = rec.full ? "Storage is full: sending" : rec.failed ? "Saved with a fault: sending" : "Sending to your phone";
  recSendShown = false;
  uiRecInfo(millis(), title, big, "Joining Wi-Fi, please wait", 0, "");
  uiTick(millis());                                    // show it NOW: joining Wi-Fi next takes several seconds
}

// One turn of the recorder (replaces the rest of the main loop while it records).
static void recLoop() {
  touchLoop();
  pwrLoop();                                         // the PWR button stops the recording too (a second way, besides the Stop button)
  raiseLoop();                                       // a dimmed recording screen brightens when the wrist is raised (if the person turned that on)
  if (recState != RS_REC) return;                    // Stop was just tapped
  static int16_t stereo[640];
  static int16_t mono[320];
  size_t got = i2s.readBytes((char *)stereo, sizeof(stereo));
  size_t frames = got / 4;
  if (frames == 0) recGaps++;
  for (size_t i = 0; i < frames; i++) {
    int16_t l = stereo[2 * i], r = stereo[2 * i + 1];
    mono[i] = (abs((int)l) >= abs((int)r)) ? l : r;
  }
  if (frames) {
    unsigned long t0 = millis();
    recFeed16k(rec, mono, (int)frames);
    unsigned long d = millis() - t0;
    if (d > recWorstOp) recWorstOp = d;
  }
  uint32_t sec = recElapsedSeconds(rec);
  if (sec != recLastSecond) {
    recLastSecond = sec;
    uint32_t cap = recSlotCapacity(recIO);
    uiRecRun(millis(), sec, recSecondsLeft(rec), cap ? (int)((uint64_t)rec.slots * 100 / cap) : 0);
  }
  if (rec.full || rec.failed) { recFinish(rec.full ? "full" : "fault"); return; }
  uiTick(millis());
}

// Sends the next piece. Called from the main loop while a recording is being sent; a piece takes under a few seconds.
static WiFiClientSecure recClient;
static void recSendFail(const char *why, int code = 0) {
  recFailures++;
  LOGF("[rec] send problem: %s %d (%d)\n", why, code, recFailures);
  recNextTry = millis() + 2000UL * recFailures;
  if (recFailures >= 3) {
    recState = RS_FAIL; recAutoAt = millis() + 600000UL;
    char reason[48];
    snprintf(reason, sizeof(reason), "%s %d, mem %uk", why, code, (unsigned)(ESP.getMaxAllocHeap() / 1024));   // what went wrong, readable in a photo
    uiRecInfo(millis(), "Couldn't send (it's safe)", "", reason, -1, "Try again");
  }
}
static void recSendStep() {
  if (WiFi.status() != WL_CONNECTED || millis() < recNextTry) return;
  if (!recSendShown) { recSendShown = true; recShowSendingPct(); }      // Wi-Fi is up: from here the screen says "Please wait" and the percent
  char rid[12]; snprintf(rid, sizeof(rid), "%08x", (unsigned)recFound.id);
  recClient.setInsecure();
  HTTPClient http;
  http.setReuse(true);
  http.setConnectTimeout(10000);
  if (!recStatusKnown) {                             // ask what the server already has (a send that was cut off carries on from there)
    http.setTimeout(15000);
    if (!http.begin(recClient, serverUrl + "/api/device/recording/" + rid)) { recSendFail("begin"); return; }
    http.addHeader("Authorization", String("Bearer ") + deviceToken);
    int code = http.GET();
    String body = code > 0 ? http.getString() : String("");
    http.end();
    if (code != 200) { recSendFail("status", code); return; }
    if (body.indexOf("\"done\":true") >= 0) { recSent = recFound.bytes; }
    else { int r = jsonInt(body, "received", 0); recSent = (uint32_t)r > recFound.bytes ? 0 : (uint32_t)r; }
    recStatusKnown = true;
    recFailures = 0;
  }
  bool already = recSent >= recFound.bytes;
  bool done = already;
  if (!already) {
    uint32_t left = recFound.bytes - recSent;
    uint32_t len = left > 65536u ? 65536u : left;
    uint8_t *buf = (uint8_t *)ps_malloc(len);
    if (!buf) buf = (uint8_t *)malloc(len = 16384u > left ? left : 16384u);
    if (!buf) { recSendFail("memory"); return; }
    if (!rpRead(REC_SECTOR + recSent, buf, len)) { free(buf); recSendFail("flash read"); return; }
    bool last = recSent + len >= recFound.bytes;
    if (last) recShowSending("Finishing up... please wait");
    http.setTimeout(last ? 180000 : 25000);          // the last piece makes the whole recording ready, which takes the server a while
    String url = serverUrl + "/api/device/recording/" + rid + "?offset=" + recSent + "&final=" + (last ? 1 : 0) + "&started=" + recFound.startedUtc;
    if (!http.begin(recClient, url)) { free(buf); recSendFail("begin"); return; }
    http.addHeader("Authorization", String("Bearer ") + deviceToken);
    http.addHeader("Content-Type", "application/octet-stream");
    int code = http.sendRequest("PUT", buf, len);
    String body = code > 0 ? http.getString() : String("");
    http.end();
    free(buf);
    if (code != 200) {
      LOGF("[rec] PUT answered %d: %s\n", code, body.c_str());
      if (code >= 400 && code < 500 && code != 408 && code != 429) recFailures = 2;   // the server refused it: one more turn and it stops trying
      recSendFail(code < 0 ? "no answer" : "refused", code);
      return;
    }
    if (body.indexOf("needFrom") >= 0) { recSent = (uint32_t)jsonInt(body, "needFrom", 0); recFailures = 0; return; }
    recSent += len; recFailures = 0;
    done = body.indexOf("\"done\":true") >= 0;
    if (last && !done) { recStatusKnown = false; recSendFail("not finished"); return; }
  }
  if (done) {
    recMarkSent(recIO);
    recFound = recLook(recIO);
    recState = RS_IDLE; recRefreshSub();
    char big[16]; recMinutesText(big, sizeof(big), recFound.ms);
    uiRecInfo(millis(), "Sent", big, "It's in the Muse app now", -1, "OK");
    LOGLN("[rec] sent");
    return;
  }
  int pct = (int)((uint64_t)recSent * 100 / (recFound.bytes ? recFound.bytes : 1));
  if (pct != recLastPct) { recLastPct = pct; recShowSendingPct(); }
}

// What the recording screens ask for: Stop, OK, Try again / Send now.
static void recAction(int what) {
  if (what == UI_REC_START) recBegin();
  else if (what == UI_REC_STOP) { if (recState == RS_REC) recFinish("stop"); }
  else if (what == UI_REC_OK) { uiRecEnd(); if (recState != RS_SEND) recState = RS_IDLE; }
  else if (what == UI_REC_RETRY) { if (recPending()) recBeginSend(); }
}
static void recPwr() { if (recState == RS_REC) recAction(UI_REC_STOP); else if (recState != RS_SEND) recAction(UI_REC_OK); }   // while recording the PWR button stops it
// Called each turn of the main loop (not while recording): carries on with a send, and starts one for a recording left behind.
static void recTick() {
  if (!recPart) return;
  if (recState == RS_SEND) { recSendStep(); return; }
  if (recState == RS_IDLE && recPending() && wsUp && mode == M_READY && !held && uiRec.state == UI_RECS_OFF && recAutoAt && millis() > recAutoAt) {
    recAutoAt = 0;
    recBeginSend();
  }
}

// ---------------------------------------------------------------- the connection to Neddy
struct CallbackTimer {  // how long this handler took (the longest is shown on screen)
  unsigned long t = millis();
  ~CallbackTimer() {
    unsigned long d = millis() - t;
    if (d > maxCb) maxCb = d;
  }
};

static void onSocket(WStype_t type, uint8_t *payload, size_t length) {
  CallbackTimer timer;
  lastRxAt = millis();
  switch (type) {
    case WStype_CONNECTED:
      LOGLN("[neddy] connected");
      wsConnects++;
      if (wsDropAt) wsBackMs = (long)(millis() - wsDropAt);
      wsUp = true;
      wsFailures = 0;
      static String info = String("{\"type\":\"device.info\",\"firmware\":\"") + FIRMWARE_VERSION + "\"}";
      ws.sendTXT(info.c_str());
      setMode(M_READY);
      break;
    case WStype_DISCONNECTED:
      if (wsUp) {
        LOGLN("[neddy] disconnected");
        wsDrops++;
        wsDropAt = millis();
      }
      wsUp = false;
      wsFailures++;
      if (held) {
        held = false;
      }
      if (mode != M_PROBLEM) setMode(M_LINK);
      break;
    case WStype_TEXT: {
      String text = String((const char *)payload).substring(0, length);
      String kind = jsonString(text, "type");
      if (kind == "hello") {
        String name = jsonString(text, "name");
        if (name.length()) deviceName = name;
        if (mode == M_READY) screenState();
      } else if (kind == "state") {
        String value = jsonString(text, "value");
        LOGF("[state] %s\n", value.c_str());
        if (value == "speaking" && !held) setMode(M_SPEAK);
        else if (value == "thinking" && !held) setMode(M_THINK);
        else if (value == "idle" && !held && mode != M_LISTEN) setMode(M_READY);
      } else if (kind == "playback.clear") {
        flushPlayback = true;
      } else if (kind == "session.output_transcript.delta") {
        saying += plain(jsonString(text, "delta"));
        uiSetWords(saying.c_str());
      } else if (kind == "session.input_transcript.delta") {
        heard += plain(jsonString(text, "delta"));
        uiSetHeard(heard.c_str());
      } else if (kind == "card") {
        // A card (the weather, a score, one fact, a short list): drawn until the next press. Ignored while the button is held.
        String cardKind = jsonString(text, "kind");
        if (cardKind == "lookup") {
          uiLookup(millis(), jsonInt(text, "on", 0) != 0 && !held);   // Neddy reads his book while a look-up runs
        } else if (held) {
          // They're talking again: no card for the last question.
        } else if (cardKind == "weather" && jsonInt(text, "temp", UI_NONE) != UI_NONE) {
          uiShowWeather(millis(), plain(jsonString(text, "place")).c_str(), jsonInt(text, "temp", UI_NONE),
                        jsonInt(text, "feels", UI_NONE), plain(jsonString(text, "sky")).c_str(),
                        uiIconByName(jsonString(text, "icon").c_str()), jsonInt(text, "high", UI_NONE),
                        jsonInt(text, "low", UI_NONE), jsonInt(text, "rain", UI_NONE),
                        plain(jsonString(text, "alert")).c_str());
        } else if (cardKind == "score") {
          uiShowScore(millis(), plain(jsonString(text, "league")).c_str(), plain(jsonString(text, "status")).c_str(),
                      plain(jsonString(text, "an")).c_str(), jsonInt(text, "as", UI_NONE),
                      plain(jsonString(text, "hn")).c_str(), jsonInt(text, "hs", UI_NONE));
        } else if (cardKind == "fact") {
          String tone = jsonString(text, "tone");
          uiShowFact(millis(), plain(jsonString(text, "label")).c_str(), plain(jsonString(text, "value")).c_str(),
                     plain(jsonString(text, "sub")).c_str(), plain(jsonString(text, "note")).c_str(),
                     tone == "good" ? 1 : (tone == "bad" ? 2 : 0));
        } else if (cardKind == "list") {
          int n = jsonInt(text, "n", 0);
          if (n > 5) n = 5;
          String labels[5], values[5];
          const char *labelPtr[5], *valuePtr[5];
          for (int i = 0; i < n; i++) {
            labels[i] = plain(jsonString(text, (String("l") + i).c_str()));
            values[i] = plain(jsonString(text, (String("v") + i).c_str()));
            labelPtr[i] = labels[i].c_str();
            valuePtr[i] = values[i].c_str();
          }
          if (n > 0) uiShowList(millis(), plain(jsonString(text, "title")).c_str(), n, labelPtr, valuePtr);
        }
      } else if (kind == "idle") {
        // The idle face's facts: the time in the person's zone, the weather in brief, the next meeting, and the settings.
        uiIdle.have = true;
        uiIdle.baseUtc = (uint32_t)jsonInt(text, "t", 0);
        uiIdle.baseMs = millis();
        uiIdle.off = jsonInt(text, "off", 0);
        uiIdle.after = jsonInt(text, "after", 10);
        uiIdle.dim = jsonInt(text, "dim", 1) != 0;
        uiIdle.showW = jsonInt(text, "sw", 1) != 0;
        uiIdle.showM = jsonInt(text, "sm", 1) != 0;
        uiIdle.showB = jsonInt(text, "sb", 1) != 0;
        uiIdle.raise = jsonInt(text, "rw", 0) != 0;
        uiIdle.dimAfter = jsonInt(text, "da", 0);
        { int b = jsonInt(text, "bs", -1); if (b >= 0 && (b != 0) != batterySaver) applySaver(b != 0); }
        { int v = jsonInt(text, "vol", -1); if (v >= 0 && v <= 100 && (volLocalAt == 0 || millis() - volLocalAt > 4000)) applyVolume(v); }
        { int f = jsonInt(text, "fps", 1); uiFpsLevel = f < 0 ? 0 : f > 2 ? 2 : f; }
        { int f = jsonInt(text, "face", 0); uiFace = f < 0 ? 0 : f > 2 ? 2 : f; }
        uiIdle.haveW = jsonInt(text, "wt", UI_NONE) != UI_NONE;
        if (uiIdle.haveW) {
          uiIdle.wt = jsonInt(text, "wt", 0);
          uiIdle.wi = uiIconByName(jsonString(text, "wi").c_str());
          uiIdle.wh = jsonInt(text, "wh", UI_NONE);
          uiIdle.wl = jsonInt(text, "wl", UI_NONE);
          uiCopyTrim(uiIdle.ws, sizeof(uiIdle.ws), plain(jsonString(text, "ws")).c_str());
        }
        uiIdle.mc = jsonInt(text, "mc", 0) != 0;
        uiIdle.haveM = jsonInt(text, "ms", 0) != 0;
        if (uiIdle.haveM) {
          uiCopyTrim(uiIdle.mt, sizeof(uiIdle.mt), plain(jsonString(text, "mt")).c_str());
          uiIdle.ms = (uint32_t)jsonInt(text, "ms", 0);
          uiIdle.me = (uint32_t)jsonInt(text, "me", 0);
        }
        uiIdleMinute = -1;
        if (uiIdleOn) uiAll = true;  // a change (a setting, a new meeting) shows at once
      } else if (kind == "latency") {
        LOGF("[latency] server says %s ms\n", text.c_str());
      } else if (kind == "error") {
        String message = plain(jsonString(text, "message"));
        LOGF("[error] %s\n", message.c_str());
        problem = message;
        if (!held) {
          screenProblem("Neddy says", message);
          mode = M_PROBLEM;
          problemUntil = millis() + 5000;  // the loop puts the normal screen back
        }
      } else if (kind == "session.closed") {
        LOGLN("[neddy] the call ended");
        if (!held && mode != M_LISTEN) setMode(M_READY);
      }
      break;
    }
    case WStype_BIN:
      if (waitingFirstSound) {
        waitingFirstSound = false;
        lastAnswerMs = (long)(millis() - releasedAt);
        LOGF("[latency] first sound %ld ms after release\n", lastAnswerMs);
      }
      if (length) xStreamBufferSend(playBuffer, payload, length, 0);
      break;
    default:
      break;
  }
}

static void startSocket() {
  wsHeader = String("Authorization: Bearer ") + deviceToken;
  ws.beginSSL(NEDDY_SERVER, 443, "/api/device/audio");
  ws.setExtraHeaders(wsHeader.c_str());
  ws.onEvent(onSocket);
  ws.setReconnectInterval(1000);
  ws.enableHeartbeat(20000, 10000, 3);  // a short Wi-Fi hiccup shouldn't end the link
}

// ---------------------------------------------------------------- Wi-Fi and pairing
// ---------------------------------------------------------------- Wi-Fi setup (the QR code)
// First start, or after "forget Wi-Fi": the watch makes its own temporary Wi-Fi (Neddy-XXXX, with a random password) and shows a QR code that makes a
// phone join it. The phone then opens a page served by the watch (any address works: every name is sent to it) where the person picks their home Wi-Fi and types
// its password. The watch tries it, saves it in its own memory, and carries on. Nothing about the person's Wi-Fi is in the program itself.
static void wifiLoadSaved() {
  wifiSsid = prefs.getString("wssid", "");
  wifiPass = prefs.getString("wpass", "");
#if NEDDY_USE_SETTINGS_WIFI && !NEDDY_FORCE_QR_SETUP
  if (wifiSsid.length() == 0 && strlen(WIFI_NAME) > 0 && strcmp(WIFI_NAME, "your Wi-Fi name") != 0) {   // edited in settings.h (not the placeholder)
    wifiSsid = WIFI_NAME;
    wifiPass = WIFI_PASSWORD;
  }
#endif
}
static void wifiForget() {
  prefs.remove("wssid");
  prefs.remove("wpass");
  wifiSsid = "";
  wifiPass = "";
}
static String jsonEsc(const String &s) {
  String o;
  for (size_t i = 0; i < s.length(); i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o;
}

// What the two setups share: the networks the watch can see, and a tap on the screen (which switches between them).
enum { SETUP_DONE = 1, SETUP_SWITCH = 2 };
struct WNet { String ssid; int rssi; bool open; };
static WNet wnets[16];
static int wnetN = 0;
static void wnetCollect() {
  int n = WiFi.scanComplete();
  wnetN = 0;
  for (int i = 0; i < n && i < 40; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0) continue;
    int r = WiFi.RSSI(i);
    bool open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
    int at = -1;
    for (int k = 0; k < wnetN; k++) if (wnets[k].ssid == s) { at = k; break; }
    if (at >= 0) { if (r > wnets[at].rssi) { wnets[at].rssi = r; wnets[at].open = open; } continue; }
    if (wnetN < 16) { wnets[wnetN].ssid = s; wnets[wnetN].rssi = r; wnets[wnetN].open = open; wnetN++; }
  }
  for (int i = 1; i < wnetN; i++) {                         // strongest first
    WNet t = wnets[i];
    int j = i - 1;
    while (j >= 0 && wnets[j].rssi < t.rssi) { wnets[j + 1] = wnets[j]; j--; }
    wnets[j + 1] = t;
  }
  WiFi.scanDelete();
}
static void wnetScanBlocking() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  WiFi.scanNetworks();
  wnetCollect();
}
static bool setupTapped() {                                // true once, when a finger has touched the screen and lifted (a short tap, not a swipe)
  static bool down = false;
  static unsigned long at = 0, polled = 0;
  static int x0 = 0, y0 = 0, lx = 0, ly = 0;
  if (!touchOk || millis() - polled < 16) return false;
  polled = millis();
  int x = 0, y = 0;
  int r = touchRead(&x, &y);
  if (r < 0) return false;
  if (r == 1) {
    if (!down) { down = true; at = millis(); x0 = x; y0 = y; }
    lx = x; ly = y;
    return false;
  }
  if (!down) return false;
  down = false;
  return millis() - at < 700 && abs(lx - x0) < 40 && abs(ly - y0) < 40;
}

// The temporary-Wi-Fi setup. Returns SETUP_DONE once the watch has joined a Wi-Fi, or SETUP_SWITCH when the person taps the screen to use Bluetooth instead.
static int wifiSetupHotspot() {
  uiActive = false;
  uiClearCard();
  wnetScanBlocking();                                      // look around first: scanning while the temporary Wi-Fi is up makes phones drop off it

  char name[16];
  snprintf(name, sizeof(name), "Neddy-%04X", (unsigned)(esp_random() & 0xFFFF));
  static const char alphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
  char pw[9];
  for (int i = 0; i < 8; i++) pw[i] = alphabet[esp_random() % 31];
  pw[8] = 0;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(name, pw);
  delay(200);
  IPAddress ip = WiFi.softAPIP();
  String portal = String("http://") + ip.toString() + "/";
  String joinQr = String("WIFI:T:WPA;S:") + name + ";P:" + pw + ";;";
  DNSServer dns;
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", ip);                                   // every name goes to the watch, so the page opens whatever the phone asks for
  WebServer web(80);
  String pendSsid, pendPass;
  bool pending = false;
  int state = 0;                                            // 0 waiting, 1 trying, 2 joined, 3 failed
  int hitsPage = 0, hitsProbe = 0, hitsOther = 0;            // what the phone has asked for (shown at the bottom of the screen)
  auto redirect = [&]() { hitsOther++; web.sendHeader("Location", portal, true); web.send(302, "text/plain", ""); };
  auto probe = [&]() { hitsProbe++; web.sendHeader("Location", portal, true); web.send(302, "text/plain", ""); };
  web.on("/", HTTP_GET, [&]() { hitsPage++; web.sendHeader("Cache-Control", "no-store"); web.send(200, "text/html", NEDDY_SETUP_PAGE); });
  web.on("/scan", HTTP_GET, [&]() {
    if (web.hasArg("again") && WiFi.scanComplete() != WIFI_SCAN_RUNNING) WiFi.scanNetworks(true);
    if (WiFi.scanComplete() == WIFI_SCAN_RUNNING) { web.send(200, "application/json", "{\"scanning\":true}"); return; }
    if (WiFi.scanComplete() >= 0) wnetCollect();
    String j = "{\"networks\":[";
    for (int i = 0; i < wnetN; i++) {
      if (i) j += ",";
      j += "{\"ssid\":\"" + jsonEsc(wnets[i].ssid) + "\",\"rssi\":" + String(wnets[i].rssi) + ",\"open\":" + (wnets[i].open ? "true" : "false") + "}";
    }
    j += "]}";
    web.send(200, "application/json", j);
  });
  web.on("/connect", HTTP_POST, [&]() {
    String s = web.arg("ssid"), p = web.arg("pass");
    if (s.length() == 0 || s.length() > 32 || p.length() > 63 || (p.length() > 0 && p.length() < 8)) {
      web.send(200, "application/json", "{\"ok\":false,\"message\":\"That name or password does not look right. Passwords are 8 to 63 characters.\"}");
      return;
    }
    pendSsid = s;
    pendPass = p;
    pending = true;
    state = 1;
    web.send(200, "application/json", "{\"ok\":true}");
  });
  web.on("/status", HTTP_GET, [&]() {
    const char *names[4] = { "idle", "trying", "ok", "fail" };
    web.send(200, "application/json", String("{\"state\":\"") + names[state] + "\"}");
  });
  const char *probes[] = { "/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html", "/connecttest.txt", "/ncsi.txt", "/fwlink", "/redirect" };
  for (const char *path : probes) web.on(path, HTTP_GET, probe);   // the little web addresses phones try to find out whether there is internet
  web.onNotFound(redirect);
  web.begin();
  LOGF("[setup] %s %s\n", name, pw);

  int stage = 0, shownHits = -1;
  auto serve = [&](unsigned long ms) { unsigned long t = millis(); while (millis() - t < ms) { dns.processNextRequest(); web.handleClient(); delay(10); } };
  unsigned long lastPhone = millis();
  bool done = false, switchMode = false;
  while (!done) {
    dns.processNextRequest();
    web.handleClient();
    int stations = WiFi.softAPgetStationNum();
    if (stations > 0) lastPhone = millis();
    int want = stations > 0 ? UI_SETUP_PAGE : UI_SETUP_JOIN;
    if (!pending && stage == UI_SETUP_JOIN && stations == 0 && setupTapped()) { switchMode = true; break; }   // a tap on the first screen: Bluetooth instead
    if (!pending && stage != want) {
      stage = want;
      shownHits = -1;
      uiSetupScreen(stage, name, stage == UI_SETUP_JOIN ? joinQr.c_str() : portal.c_str(), ip.toString().c_str());
    }
    if (!pending && (stage == UI_SETUP_PAGE || stage == UI_SETUP_JOIN) && (hitsPage + hitsProbe + hitsOther != shownHits)) {
      shownHits = hitsPage + hitsProbe + hitsOther;
      if (shownHits > 0) {
        char d[64];
        snprintf(d, sizeof(d), "reached watch: page %d  checks %d  other %d", hitsPage, hitsProbe, hitsOther);
        uiSetupDiag(d);
      }
    }
    if (pending) {
      pending = false;
      stage = UI_SETUP_TRYING;
      uiSetupScreen(stage, pendSsid.c_str(), "", "");
      WiFi.begin(pendSsid.c_str(), pendPass.c_str());
      unsigned long t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { dns.processNextRequest(); web.handleClient(); delay(20); }
      if (WiFi.status() == WL_CONNECTED) {
        wifiSsid = pendSsid;
        wifiPass = pendPass;
        prefs.putString("wssid", wifiSsid);
        prefs.putString("wpass", wifiPass);
        state = 2;
        uiSetupScreen(UI_SETUP_DONE, wifiSsid.c_str(), "", "");
        serve(4000);                                        // long enough for the phone's page to read "ok"
        done = true;
      } else {
        WiFi.disconnect(false);
        state = 3;
        uiSetupScreen(UI_SETUP_FAIL, pendSsid.c_str(), "", "");
        serve(3500);
        stage = 0;                                          // draws the page screen again
      }
    }
    if (millis() - lastPhone > 15UL * 60UL * 1000UL) ESP.restart();   // nobody came: start over (and stop using the battery)
    delay(5);
  }
  web.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  return switchMode ? SETUP_SWITCH : SETUP_DONE;
}

// ---------------------------------------------------------------- Wi-Fi setup by Bluetooth
// The watch advertises a small Bluetooth service (Neddy-XXXX). The phone's browser (Chrome, from the QR code) connects, reads the list of Wi-Fi networks the watch
// sees, and writes back the code from the QR, the Wi-Fi name and its password (three lines of text, in pieces of up to 100 bytes). The watch checks the code,
// tries the Wi-Fi, says "trying", then "ok" or "fail" (the page reads that), saves the Wi-Fi and carries on. The same three numbers are in watch-setup.html.
static volatile bool bleConnected = false, bleFresh = false;
static String bleIn;
static BLECharacteristic *bleStatusChar = nullptr;
static bool bleMemoryReleased = false;                     // after a finished setup the Bluetooth memory is given back (it can't start again until a restart)
static void bleStatus(const char *text) { if (bleStatusChar) bleStatusChar->setValue((uint8_t *)text, strlen(text)); }
class NeddyBleServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleConnected = true; }
  void onDisconnect(BLEServer *) override { bleConnected = false; BLEDevice::startAdvertising(); }
};
class NeddyBleWriteCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    auto v = c->getValue();                                // (a String or a std::string, depending on the core's version: both have these two)
    const char *p = v.c_str();
    size_t n = v.length();
    for (size_t i = 0; i < n && bleIn.length() < 400; i++) bleIn += p[i];
    int lines = 0;
    for (size_t i = 0; i < bleIn.length(); i++) if (bleIn[i] == '\n') lines++;
    if (lines >= 3) bleFresh = true;                       // code, name, password: all there
  }
};

static int wifiSetupBluetooth() {
  if (bleMemoryReleased) return SETUP_SWITCH;
  uiActive = false;
  uiClearCard();
  wnetScanBlocking();                                      // the networks, before Bluetooth shares the radio
  char suffix[8], name[16], key[8];
  snprintf(suffix, sizeof(suffix), "%04X", (unsigned)(esp_random() & 0xFFFF));
  snprintf(name, sizeof(name), "Neddy-%s", suffix);
  snprintf(key, sizeof(key), "%06u", (unsigned)(esp_random() % 1000000UL));
  String url = String(NEDDY_SETUP_URL) + "#n=" + suffix + "&k=" + key;      // after the # nothing is sent to any server
  bleIn = "";
  bleFresh = false;
  bleConnected = false;
  BLEDevice::init(name);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new NeddyBleServerCb());
  BLEService *svc = server->createService(NEDDY_BLE_SERVICE);
  BLECharacteristic *netsChar = svc->createCharacteristic(NEDDY_BLE_NETWORKS, BLECharacteristic::PROPERTY_READ);
  BLECharacteristic *credChar = svc->createCharacteristic(NEDDY_BLE_CREDENTIALS, BLECharacteristic::PROPERTY_WRITE);
  bleStatusChar = svc->createCharacteristic(NEDDY_BLE_STATUS, BLECharacteristic::PROPERTY_READ);
  credChar->setCallbacks(new NeddyBleWriteCb());
  String list = String("{\"n\":\"") + suffix + "\",\"w\":[";
  bool first = true;
  for (int i = 0; i < wnetN; i++) {
    String item = String(first ? "" : ",") + "[\"" + jsonEsc(wnets[i].ssid) + "\"," + String(wnets[i].rssi) + "," + (wnets[i].open ? "1" : "0") + "]";
    if (list.length() + item.length() + 3 > 480) break;      // a read gives at most about 500 bytes
    list += item;
    first = false;
  }
  list += "]}";
  netsChar->setValue((uint8_t *)list.c_str(), list.length());
  bleStatus("ready");
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NEDDY_BLE_SERVICE);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  LOGF("[setup] bluetooth %s key %s\n", name, key);

  int shown = 0, result = 0;
  unsigned long lastPhone = millis();
  while (!result) {
    int want = bleConnected ? UI_SETUP_BLE_PHONE : UI_SETUP_BLE;
    if (want != shown) { shown = want; uiSetupScreen(want, name, url.c_str(), ""); }
    if (bleConnected) lastPhone = millis();
    if (!bleConnected && setupTapped()) { result = SETUP_SWITCH; break; }   // a tap: the temporary Wi-Fi setup instead (for iPhones)
    if (bleFresh) {
      bleFresh = false;
      String in = bleIn;
      bleIn = "";
      int a = in.indexOf('\n'), b = a < 0 ? -1 : in.indexOf('\n', a + 1), c = b < 0 ? -1 : in.indexOf('\n', b + 1);
      String k = a < 0 ? "" : in.substring(0, a), s = b < 0 ? "" : in.substring(a + 1, b), p = c < 0 ? "" : in.substring(b + 1, c);
      if (c < 0 || k != key || s.length() == 0 || s.length() > 32 || p.length() > 63 || (p.length() > 0 && p.length() < 8)) {
        bleStatus("badkey");
        shown = 0;
        continue;
      }
      bleStatus("trying");
      uiSetupScreen(UI_SETUP_TRYING, s.c_str(), "", "");
      WiFi.mode(WIFI_STA);
      WiFi.begin(s.c_str(), p.c_str());
      unsigned long t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(50);
      if (WiFi.status() == WL_CONNECTED) {
        wifiSsid = s;
        wifiPass = p;
        prefs.putString("wssid", wifiSsid);
        prefs.putString("wpass", wifiPass);
        bleStatus("ok");
        uiSetupScreen(UI_SETUP_DONE, wifiSsid.c_str(), "", "");
        delay(2500);                                       // long enough for the phone's page to read "ok"
        result = SETUP_DONE;
      } else {
        WiFi.disconnect();
        bleStatus("fail");
        uiSetupScreen(UI_SETUP_FAIL, s.c_str(), "", "");
        delay(3000);
        shown = 0;
      }
    }
    if (millis() - lastPhone > 15UL * 60UL * 1000UL) ESP.restart();   // nobody came: start over (and stop using the battery)
    delay(20);
  }
  bleStatusChar = nullptr;
  BLEDevice::deinit(result == SETUP_DONE);                 // done: the memory goes back to the program (TLS needs it); a tap: keep it so Bluetooth can start again
  if (result == SETUP_DONE) bleMemoryReleased = true;
  return result;
}

// Wi-Fi setup: Bluetooth first (the QR opens a page in the phone's browser); a tap on the screen swaps to the temporary Wi-Fi, and back.
static void wifiSetupRun() {
  int m = NEDDY_BLE_FIRST ? 0 : 1;
  for (;;) {
    if (m == 0 && bleMemoryReleased) m = 1;
    int r = (m == 0) ? wifiSetupBluetooth() : wifiSetupHotspot();
    if (r == SETUP_DONE) return;
    m ^= 1;
  }
}

static bool joinWifi() {
  if (recState == RS_SEND) { recShowSending("Joining Wi-Fi, please wait"); }   // (the recording's screen stays; the usual "Joining Wi-Fi" screen would cover it)
  setMode(M_WIFI);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(batterySaver);  // saver on: the radio sleeps between messages; off: faster answers
  setCpuFrequencyMhz(batterySaver ? 160 : 240);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  unsigned long began = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - began < 30000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    LOGF("[wifi] joined, address %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  return false;
}

// Shows a code and waits until the person has typed it in the app. Returns true once paired.
static bool pairWithNeddy() {
  for (int round = 0; round < 1000; round++) {
    int status = 0;
    String answer = httpPost("/api/device/pair/start",
                             String("{\"model\":\"") + DEVICE_MODEL + "\"}", status);
    String code = jsonString(answer, "code");
    String pollToken = jsonString(answer, "pollToken");
    if (status != 201 || code.length() != 6 || pollToken.length() == 0) {
      LOGF("[pair] couldn't get a code (status %d): %s\n", status, answer.c_str());
      screenProblem("Can't reach Neddy",
                    String("Checking again in a few seconds. (code ") + status + ")");
      delay(6000);
      if (WiFi.status() != WL_CONNECTED) return false;
      continue;
    }
    LOGF("[pair] show code %s\n", code.c_str());
    unsigned long until = millis() + 590000UL;
    int shownSeconds = -1;
    unsigned long lastPoll = 0;
    while (millis() < until) {
      int left = (until - millis()) / 1000;
      if (left != shownSeconds) {
        shownSeconds = left;
        if (left % 5 == 0 || left > 585) screenPair(code, left);
      }
      if (millis() - lastPoll > 3000) {
        lastPoll = millis();
        int st = 0;
        String poll = httpPost("/api/device/pair/poll", String("{\"pollToken\":\"") + pollToken + "\"}", st);
        String result = jsonString(poll, "status");
        if (result == "paired") {
          String token = jsonString(poll, "token");
          String name = jsonString(poll, "name");
          if (token.length() > 20) {
            deviceToken = token;
            if (name.length()) deviceName = name;
            prefs.putString("token", deviceToken);
            prefs.putString("name", deviceName);
            LOGLN("[pair] paired!");
            screenBoot("Paired!");
            delay(1500);
            return true;
          }
        } else if (result == "expired") {
          break;  // ask for a fresh code
        }
      }
      if (WiFi.status() != WL_CONNECTED) return false;
      delay(100);
    }
  }
  return false;
}

// ---------------------------------------------------------------- start and run
void setup() {
  Serial.begin(115200);
  delay(300);
  LOGLN("\nNeddy device " FIRMWARE_VERSION);
  LOGLN("[build] 2026-11-12 volume screen, power-chip key, [batt] and [raise] lines");
  bootCount++;
  resetWhy = String("start ") + bootCount + ": " + resetName((int)esp_reset_reason());
  LOGLN(resetWhy);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(10, INPUT);   // PWR button: high while pressed

  if (!gfx->begin()) LOGLN("[screen] gfx->begin() failed");
  uiOut.blit = outBlit;
  uiOut.fill = outFill;
  uiMicros = []() -> uint32_t { return (uint32_t)micros(); };
  // The idle face dims the screen with the display chip's own brightness command (0x51).
  uiOut.brightness = [](int level) {
    bus->beginWrite();
    bus->writeC8D8(0x51, (uint8_t)level);
    bus->endWrite();
  };
  // A setting changed on the watch itself (the menu): tell the server so it keeps it and says it back after a restart.
  uiOut.setting = [](int which, int value) {
    if (which == UI_SET_VOLUME) { volLocalAt = millis(); applyVolume(value); playBeep(); }   // the audio chip first, then a short note at the new volume
    if (wsUp && (which == UI_SET_ANIM || which == UI_SET_FACE || which == UI_SET_VOLUME)) {
      String m = String("{\"type\":\"device.setting\",\"key\":\"") + (which == UI_SET_ANIM ? "animation" : which == UI_SET_VOLUME ? "volume" : "face") + "\",\"value\":" + value + "}";
      ws.sendTXT(m.c_str());
    }
  };
  uiOut.record = recAction;
  uiMotion = NEDDY_MOTION != 0;
  uiShowDiag = NEDDY_DIAG != 0 || NEDDY_IDLE_DEBUG != 0 || NEDDY_RAISE_DEBUG != 0;
  screenBoot("Starting");

  prefs.begin("neddy", false);
  // Hold BOOT while plugging in to forget the pairing and start over.
  if (digitalRead(BUTTON) == LOW) {
    delay(1500);
    if (digitalRead(BUTTON) == LOW) {
      prefs.remove("token");
      prefs.remove("name");
      screenBoot("Pairing cleared");
      LOGLN("[pair] cleared");
      delay(1200);
      screenBoot("Keep holding: Wi-Fi too");
      unsigned long h = millis();
      while (digitalRead(BUTTON) == LOW && millis() - h < 3500) delay(50);
      if (digitalRead(BUTTON) == LOW) {          // still held: forget the Wi-Fi as well, and the QR code setup starts
        wifiForget();
        screenBoot("Wi-Fi cleared");
        LOGLN("[wifi] cleared");
        delay(1500);
      }
    }
  }
  wifiLoadSaved();
  deviceToken = prefs.getString("token", "");
  String savedName = prefs.getString("name", "");
  if (savedName.length()) deviceName = savedName;
  serverUrl = String("https://") + NEDDY_SERVER;

  if (!audioInit()) {
    screenProblem("Audio didn't start", "The microphone or speaker chip didn't answer. Unplug and replug the board. If it keeps happening, tell Mark and send the text from the Serial Monitor.");
    for (;;) delay(1000);
  }
  xTaskCreatePinnedToCore(playTask, "play", 6144, NULL, 3, NULL, 1);
  touchInit();
  recInit();
}

void loop() {
  unsigned long turnAt = millis();
  if (loopPrev && turnAt - loopPrev > maxLoop) maxLoop = turnAt - loopPrev;
  loopPrev = turnAt;
  // 0. Recording: the recorder has the loop to itself (no Wi-Fi, no talking) until Stop
  if (recState == RS_REC) { recLoop(); return; }
  // 1. Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    wsUp = false;
    if (wifiSsid.length() == 0) {              // none saved yet (a new watch, or it was forgotten): the QR code setup
      wifiSetupRun();
      mode = M_BOOT;
      return;
    }
    if (!joinWifi()) {
      screenProblem("Can't join Wi-Fi",
                    String("I'll keep trying. Network: ") + wifiSsid + ". To pick a different Wi-Fi, hold the BOOT button for 3 seconds.");
      mode = M_PROBLEM;
      unsigned long until = millis() + 10000, heldAt = 0;
      while (millis() < until) {               // a long press on BOOT forgets this Wi-Fi, and the setup starts next turn
        if (digitalRead(BUTTON) == LOW) {
          if (!heldAt) heldAt = millis();
          if (millis() - heldAt > 3000) { wifiForget(); ESP.restart(); }
        } else {
          heldAt = 0;
        }
        delay(50);
      }
      mode = M_BOOT;
      return;
    }
  }

  // 2. Pairing (only until it works once; it's remembered after that)
  if (deviceToken.length() == 0) {
    setMode(M_PAIR);
    if (!pairWithNeddy()) return;
    socketStarted = false;  // the connection below starts with the new key
    return;
  }

  // 3. The connection to Neddy
  const bool uploading = recState == RS_SEND;                    // the upload gets the memory to itself: no connection to Neddy until it is done
  if (!socketStarted && !uploading) {
    setMode(M_LINK);
    startSocket();
    socketStarted = true;
  }
  unsigned long wsAt = millis();
  if (socketStarted) ws.loop();
  if (millis() - wsAt > maxWs) maxWs = millis() - wsAt;

  // A key that doesn't work any more (removed in the app): the connection never opens.
  if (!wsUp && wsFailures >= 12) {
    wsFailures = 0;
    screenProblem("Neddy won't let me in", "I may have been removed from your devices. Unplug me, hold BOOT while plugging back in, keep holding for two seconds, then pair again.");
    mode = M_PROBLEM;
    delay(15000);
    mode = M_BOOT;
    setMode(M_LINK);
  }

  if (problemUntil && millis() > problemUntil) {
    problemUntil = 0;
    mode = M_BOOT;
    setMode(wsUp ? M_READY : M_LINK);
  }

  // 4. The touch screen and the button: holding Neddy (or a double tap) counts as holding the button
  touchLoop();
  batteryLoop();
  statusLoop();
  pwrLoop();
  raiseLoop();
  recTick();
  bool down = (buttonDown() || uiTouchTalk) && uiRec.state == UI_RECS_OFF;
  if (down && !held) {
    if (wsUp && mode != M_PROBLEM) {
      unsigned long startAt = millis();
      startTalking();
      maxStart = millis() - startAt;
      blockedPrev = 0;
    } else {
      blockedWhy = wsUp ? 'P' : 'L';
      unsigned long t = millis();
      if (blockedPrev) blockedMs += t - blockedPrev;
      blockedPrev = t;
    }
  } else if (!down) {
    blockedPrev = 0;
  }
  if (held) {
    if (!down || millis() - pressStart > (unsigned long)MAX_TALK_SECONDS * 1000UL) stopTalking();
    else sendMicChunk();
  } else if (wsUp) {
    // The microphone only needs emptying now and then between presses (each read waits 20 ms, which held the animation at about 17 frames a second).
    static unsigned long lastIdleRead = 0;
    if (IDLE_MIC_EVERY_MS == 0 || millis() - lastIdleRead >= IDLE_MIC_EVERY_MS) {
      lastIdleRead = millis();
      unsigned long idleAt = millis();
      idleMic();
      if (millis() - idleAt > maxIdle) maxIdle = millis() - idleAt;
    }
  }

  // Neddy's screen: draws only what changed (and the moving parts if motion is on).
  if (uiActive) {
    if (mode == M_READY && millis() - lastDiag > 5000) {   // Wi-Fi strength and the like
      lastDiag = millis();
      buildDiag();
    }
    uiTick(millis());
  }
  // With the battery saver on the processor rests between turns of the loop instead of spinning: nothing here needs more than ~250 turns a second (not while talking).
  if (batterySaver && !held && uiRec.state == UI_RECS_OFF) delay(4);
}
