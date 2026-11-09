// Neddy on the Waveshare ESP32-S3-Touch-AMOLED-2.06 board. Version 0.1 (early testing).
//
// What it does: joins your Wi-Fi, shows a six-digit code so you can pair it with your Neddy account,
// then lets you hold the BOOT button to talk to Neddy and hear her answer.
//
// Needs (all in the setup guide): Arduino IDE, "esp32 by Espressif Systems" 3.3.11, Waveshare's
// libraries (Arduino_GFX etc.), and the library "WebSockets" by Markus Sattler (Library Manager).
//
// Audio setup, pins and the display come from Waveshare's own examples (01_HelloWorld, 08_ES8311).

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <ESP_I2S.h>
#include <WebSocketsClient.h>
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
// amplifier off). The prototype's speaker wire is broken, and after an answer was played the microphone
// stopped delivering sound, so this is off while that is being tracked down.
#ifndef PLAY_ANSWERS
#define PLAY_ANSWERS 0
#endif

// ---------------------------------------------------------------- screen
Arduino_DataBus *bus = new Arduino_ESP32QSPI(
  LCD_CS, LCD_SCLK, LCD_SDIO0, LCD_SDIO1, LCD_SDIO2, LCD_SDIO3);
Arduino_GFX *gfx = new Arduino_CO5300(bus, LCD_RESET, 0 /* rotation */, LCD_WIDTH, LCD_HEIGHT,
                                      22 /* col_offset1 */, 0, 0, 0);

// ---------------------------------------------------------------- the screen (the drawing is in neddy_ui.h)
#include "neddy_ui.h"

// 1 = Neddy moves all the time (breathing, floating, glancing). 0 = still, except his eyes (and blinking).
#ifndef NEDDY_MOTION
#define NEDDY_MOTION 1
#endif

// 1 = show the small lines of numbers (Wi-Fi, microphone, timings) at the bottom of the screen.
#ifndef NEDDY_DIAG
#define NEDDY_DIAG 0
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

static WebSocketsClient ws;
static bool wsUp = false;
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
      uiActive = false;
      uiClearCard();
      clearScreen();
      uiTextCentered(NFONT_TITLE, 150, "Joining Wi-Fi", UI_WHITE);
      uiTextCentered(NFONT_BODY, 230, WIFI_NAME, UI_GREY);
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
static esp_err_t codecInit() {
  es8311_handle_t handle = es8311_create(0, ES8311_ADDRRES_0);
  ESP_RETURN_ON_FALSE(handle, ESP_FAIL, "codec", "es8311 create failed");
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
  ESP_RETURN_ON_ERROR(es8311_voice_volume_set(handle, SPEAKER_VOLUME, NULL), "codec", "volume failed");
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
  pinMode(46, OUTPUT);
  digitalWrite(46, PLAY_ANSWERS ? HIGH : LOW);  // speaker amplifier
  if (codecInit() != ESP_OK) {
    LOGLN("[audio] audio chip setup failed");
    return false;
  }
  es7210Init();  // the microphone chip; a problem is shown on screen, not fatal
  playBuffer = xStreamBufferCreate(48 * 1024, 2);
  return playBuffer != NULL;
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
        if (held) {
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
        uiIdle.after = jsonInt(text, "after", 20);
        uiIdle.dim = jsonInt(text, "dim", 1) != 0;
        uiIdle.showW = jsonInt(text, "sw", 1) != 0;
        uiIdle.showM = jsonInt(text, "sm", 1) != 0;
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
static bool joinWifi() {
  setMode(M_WIFI);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // faster answers
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
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
  bootCount++;
  resetWhy = String("start ") + bootCount + ": " + resetName((int)esp_reset_reason());
  LOGLN(resetWhy);
  pinMode(BUTTON, INPUT_PULLUP);

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
  uiMotion = NEDDY_MOTION != 0;
  uiShowDiag = NEDDY_DIAG != 0;
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
      delay(2000);
    }
  }
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
}

void loop() {
  unsigned long turnAt = millis();
  if (loopPrev && turnAt - loopPrev > maxLoop) maxLoop = turnAt - loopPrev;
  loopPrev = turnAt;
  // 1. Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    wsUp = false;
    if (!joinWifi()) {
      screenProblem("Can't join Wi-Fi",
                    String("Check the name and password in settings.h, and that it's a 2.4 GHz network. Trying again soon. Name used: ") + WIFI_NAME);
      mode = M_PROBLEM;
      delay(10000);
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
  if (!socketStarted) {
    setMode(M_LINK);
    startSocket();
    socketStarted = true;
  }
  unsigned long wsAt = millis();
  ws.loop();
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
  bool down = buttonDown() || uiTouchTalk;
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
    unsigned long idleAt = millis();
    idleMic();
    if (millis() - idleAt > maxIdle) maxIdle = millis() - idleAt;
  }

  // Neddy's screen: draws only what changed (and the moving parts if motion is on).
  if (uiActive) {
    if (mode == M_READY && millis() - lastDiag > 5000) {   // Wi-Fi strength and the like
      lastDiag = millis();
      buildDiag();
    }
    uiTick(millis());
  }
}
