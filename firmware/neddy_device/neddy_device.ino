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

static uint16_t cBlack, cWhite, cGrey, cTeal, cRed, cAmber, cGreen;
static void makeColours() {
  cBlack = gfx->color565(0, 0, 0);
  cWhite = gfx->color565(255, 255, 255);
  cGrey = gfx->color565(150, 160, 165);
  cTeal = gfx->color565(43, 200, 180);
  cRed = gfx->color565(240, 80, 70);
  cAmber = gfx->color565(255, 180, 60);
  cGreen = gfx->color565(80, 220, 120);
}

// Text with the built-in font, scaled. One character is 6 x 8 pixels at size 1.
// ---------------------------------------------------------------- text
// The 5x7 letters of Arduino_GFX's own classic font (ASCII 32 to 126), kept here so a whole line of text can be
// drawn into memory and sent to the screen in ONE go. The library draws every lit dot of a scaled letter as its
// own screen command, which took seconds for a screen full of text and froze the board.
static const uint8_t NEDDY_FONT[95][5] = {
  {0x00, 0x00, 0x00, 0x00, 0x00},  // ' '
  {0x00, 0x00, 0x5F, 0x00, 0x00},  // '!'
  {0x00, 0x07, 0x00, 0x07, 0x00},  // '"'
  {0x14, 0x7F, 0x14, 0x7F, 0x14},  // '#'
  {0x24, 0x2A, 0x7F, 0x2A, 0x12},  // '$'
  {0x23, 0x13, 0x08, 0x64, 0x62},  // '%'
  {0x36, 0x49, 0x56, 0x20, 0x50},  // '&'
  {0x00, 0x08, 0x07, 0x03, 0x00},  // '''
  {0x00, 0x1C, 0x22, 0x41, 0x00},  // '('
  {0x00, 0x41, 0x22, 0x1C, 0x00},  // ')'
  {0x2A, 0x1C, 0x7F, 0x1C, 0x2A},  // '*'
  {0x08, 0x08, 0x3E, 0x08, 0x08},  // '+'
  {0x00, 0x80, 0x70, 0x30, 0x00},  // ','
  {0x08, 0x08, 0x08, 0x08, 0x08},  // '-'
  {0x00, 0x00, 0x60, 0x60, 0x00},  // '.'
  {0x20, 0x10, 0x08, 0x04, 0x02},  // '/'
  {0x3E, 0x51, 0x49, 0x45, 0x3E},  // '0'
  {0x00, 0x42, 0x7F, 0x40, 0x00},  // '1'
  {0x72, 0x49, 0x49, 0x49, 0x46},  // '2'
  {0x21, 0x41, 0x49, 0x4D, 0x33},  // '3'
  {0x18, 0x14, 0x12, 0x7F, 0x10},  // '4'
  {0x27, 0x45, 0x45, 0x45, 0x39},  // '5'
  {0x3C, 0x4A, 0x49, 0x49, 0x31},  // '6'
  {0x41, 0x21, 0x11, 0x09, 0x07},  // '7'
  {0x36, 0x49, 0x49, 0x49, 0x36},  // '8'
  {0x46, 0x49, 0x49, 0x29, 0x1E},  // '9'
  {0x00, 0x00, 0x14, 0x00, 0x00},  // ':'
  {0x00, 0x40, 0x34, 0x00, 0x00},  // ';'
  {0x00, 0x08, 0x14, 0x22, 0x41},  // '<'
  {0x14, 0x14, 0x14, 0x14, 0x14},  // '='
  {0x00, 0x41, 0x22, 0x14, 0x08},  // '>'
  {0x02, 0x01, 0x59, 0x09, 0x06},  // '?'
  {0x3E, 0x41, 0x5D, 0x59, 0x4E},  // '@'
  {0x7C, 0x12, 0x11, 0x12, 0x7C},  // 'A'
  {0x7F, 0x49, 0x49, 0x49, 0x36},  // 'B'
  {0x3E, 0x41, 0x41, 0x41, 0x22},  // 'C'
  {0x7F, 0x41, 0x41, 0x41, 0x3E},  // 'D'
  {0x7F, 0x49, 0x49, 0x49, 0x41},  // 'E'
  {0x7F, 0x09, 0x09, 0x09, 0x01},  // 'F'
  {0x3E, 0x41, 0x41, 0x51, 0x73},  // 'G'
  {0x7F, 0x08, 0x08, 0x08, 0x7F},  // 'H'
  {0x00, 0x41, 0x7F, 0x41, 0x00},  // 'I'
  {0x20, 0x40, 0x41, 0x3F, 0x01},  // 'J'
  {0x7F, 0x08, 0x14, 0x22, 0x41},  // 'K'
  {0x7F, 0x40, 0x40, 0x40, 0x40},  // 'L'
  {0x7F, 0x02, 0x1C, 0x02, 0x7F},  // 'M'
  {0x7F, 0x04, 0x08, 0x10, 0x7F},  // 'N'
  {0x3E, 0x41, 0x41, 0x41, 0x3E},  // 'O'
  {0x7F, 0x09, 0x09, 0x09, 0x06},  // 'P'
  {0x3E, 0x41, 0x51, 0x21, 0x5E},  // 'Q'
  {0x7F, 0x09, 0x19, 0x29, 0x46},  // 'R'
  {0x26, 0x49, 0x49, 0x49, 0x32},  // 'S'
  {0x03, 0x01, 0x7F, 0x01, 0x03},  // 'T'
  {0x3F, 0x40, 0x40, 0x40, 0x3F},  // 'U'
  {0x1F, 0x20, 0x40, 0x20, 0x1F},  // 'V'
  {0x3F, 0x40, 0x38, 0x40, 0x3F},  // 'W'
  {0x63, 0x14, 0x08, 0x14, 0x63},  // 'X'
  {0x03, 0x04, 0x78, 0x04, 0x03},  // 'Y'
  {0x61, 0x59, 0x49, 0x4D, 0x43},  // 'Z'
  {0x00, 0x7F, 0x41, 0x41, 0x41},  // '['
  {0x02, 0x04, 0x08, 0x10, 0x20},  // 'backslash'
  {0x00, 0x41, 0x41, 0x41, 0x7F},  // ']'
  {0x04, 0x02, 0x01, 0x02, 0x04},  // '^'
  {0x40, 0x40, 0x40, 0x40, 0x40},  // '_'
  {0x00, 0x03, 0x07, 0x08, 0x00},  // '`'
  {0x20, 0x54, 0x54, 0x78, 0x40},  // 'a'
  {0x7F, 0x28, 0x44, 0x44, 0x38},  // 'b'
  {0x38, 0x44, 0x44, 0x44, 0x28},  // 'c'
  {0x38, 0x44, 0x44, 0x28, 0x7F},  // 'd'
  {0x38, 0x54, 0x54, 0x54, 0x18},  // 'e'
  {0x00, 0x08, 0x7E, 0x09, 0x02},  // 'f'
  {0x18, 0xA4, 0xA4, 0x9C, 0x78},  // 'g'
  {0x7F, 0x08, 0x04, 0x04, 0x78},  // 'h'
  {0x00, 0x44, 0x7D, 0x40, 0x00},  // 'i'
  {0x20, 0x40, 0x40, 0x3D, 0x00},  // 'j'
  {0x7F, 0x10, 0x28, 0x44, 0x00},  // 'k'
  {0x00, 0x41, 0x7F, 0x40, 0x00},  // 'l'
  {0x7C, 0x04, 0x78, 0x04, 0x78},  // 'm'
  {0x7C, 0x08, 0x04, 0x04, 0x78},  // 'n'
  {0x38, 0x44, 0x44, 0x44, 0x38},  // 'o'
  {0xFC, 0x18, 0x24, 0x24, 0x18},  // 'p'
  {0x18, 0x24, 0x24, 0x18, 0xFC},  // 'q'
  {0x7C, 0x08, 0x04, 0x04, 0x08},  // 'r'
  {0x48, 0x54, 0x54, 0x54, 0x24},  // 's'
  {0x04, 0x04, 0x3F, 0x44, 0x24},  // 't'
  {0x3C, 0x40, 0x40, 0x20, 0x7C},  // 'u'
  {0x1C, 0x20, 0x40, 0x20, 0x1C},  // 'v'
  {0x3C, 0x40, 0x30, 0x40, 0x3C},  // 'w'
  {0x44, 0x28, 0x10, 0x28, 0x44},  // 'x'
  {0x4C, 0x90, 0x90, 0x90, 0x7C},  // 'y'
  {0x44, 0x64, 0x54, 0x4C, 0x44},  // 'z'
  {0x00, 0x08, 0x36, 0x41, 0x00},  // '{'
  {0x00, 0x00, 0x77, 0x00, 0x00},  // '|'
  {0x00, 0x41, 0x36, 0x08, 0x00},  // '}'
  {0x02, 0x01, 0x02, 0x04, 0x02},  // '~'
};

static uint16_t lineBuf[LCD_WIDTH * 32];  // one line of text, up to 4x size

static void drawText(const String &text, int x, int y, int size, uint16_t fg) {
  if (size < 1) size = 1;
  if (size > 4) size = 4;
  int cw = 6 * size, ch = 8 * size;
  int n = text.length();
  int fit = (LCD_WIDTH - x) / cw;
  if (n > fit) n = fit;
  if (n <= 0 || x < 0) return;
  int w = n * cw;
  const uint16_t bg = cBlack;
  for (int i = 0; i < w * ch; i++) lineBuf[i] = bg;
  for (int k = 0; k < n; k++) {
    int c = (uint8_t)text[k];
    if (c < 32 || c > 126) c = '?';
    const uint8_t *glyph = NEDDY_FONT[c - 32];
    for (int col = 0; col < 5; col++) {
      uint8_t bits = glyph[col];
      for (int row = 0; row < 8; row++) {
        if (!((bits >> row) & 1)) continue;
        for (int dy = 0; dy < size; dy++) {
          uint16_t *at = &lineBuf[(row * size + dy) * w + k * cw + col * size];
          for (int dx = 0; dx < size; dx++) at[dx] = fg;
        }
      }
    }
  }
  gfx->draw16bitRGBBitmap(x, y, lineBuf, w, ch);
}

static void centered(const String &text, int y, int size, uint16_t colour) {
  int w = text.length() * 6 * size;
  int x = (LCD_WIDTH - w) / 2;
  if (x < 4) x = 4;
  drawText(text, x, y, size, colour);
}

// Wrapped text inside a box (left, top, width), broken at spaces.
static void wrapped(const String &text, int left, int top, int width, int size, uint16_t colour,
                    int maxLines) {
  int perLine = width / (6 * size);
  if (perLine < 4) perLine = 4;
  int y = top, start = 0, lines = 0;
  while (start < (int)text.length() && lines < maxLines) {
    int end = start + perLine;
    if (end >= (int)text.length()) {
      end = text.length();
    } else {
      int space = text.lastIndexOf(' ', end);
      if (space > start) end = space;
    }
    String line = text.substring(start, end);
    line.trim();
    drawText(line, left, y, size, colour);
    y += 9 * size + 4;
    start = end;
    while (start < (int)text.length() && text[start] == ' ') start++;
    lines++;
  }
}

static void clearScreen() { gfx->fillScreen(cBlack); }

// ---------------------------------------------------------------- state
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
static void screenBoot(const String &line) {
  clearScreen();
  centered("Neddy", 150, 8, cTeal);
  centered(line, 300, 3, cGrey);
  centered(String("version ") + FIRMWARE_VERSION, 450, 2, cGrey);
}

static void screenProblem(const String &title, const String &detail) {
  clearScreen();
  centered(title, 110, 4, cAmber);
  wrapped(detail, 30, 200, LCD_WIDTH - 60, 3, cWhite, 12);
}

static void screenPair(const String &code, int secondsLeft) {
  clearScreen();
  centered("Pair me with Neddy", 50, 3, cWhite);
  String shown = code.substring(0, 3) + " " + code.substring(3);
  centered(shown, 130, 9, cTeal);
  wrapped(String("On your phone open Neddy, then You > Account > Your devices, and type this code. ")
          + "Or say to Neddy: pair my device.",
          30, 250, LCD_WIDTH - 60, 2, cWhite, 8);
  char buf[32];
  snprintf(buf, sizeof(buf), "Works for %d:%02d", secondsLeft / 60, secondsLeft % 60);
  centered(String(buf), 440, 2, cGrey);
}

static void drawLevel(int level /* 0..100 */) {
  const int x = 55, y = 430, w = LCD_WIDTH - 110, h = 20;
  gfx->fillRect(x, y, w, h, cBlack);
  gfx->drawRect(x, y, w, h, cGrey);
  int fill = (w - 4) * level / 100;
  if (fill > 0) gfx->fillRect(x + 2, y + 2, fill, h - 4, cTeal);
}

// A small live microphone bar at the bottom of the ready screen (so a dead or quiet microphone is easy to see).
static void drawIdleLevel(int level /* 0..100 */) {
  const int x = 55, y = 474, w = LCD_WIDTH - 110, h = 14;
  gfx->fillRect(x, y, w, h, cBlack);
  gfx->drawRect(x, y, w, h, cGrey);
  int fill = (w - 4) * level / 100;
  if (fill > 0) gfx->fillRect(x + 2, y + 2, fill, h - 4, cGreen);
}

static void screenState() {
  clearScreen();
  switch (mode) {
    case M_WIFI:
      centered("Joining Wi-Fi", 150, 4, cWhite);
      centered(WIFI_NAME, 230, 3, cGrey);
      break;
    case M_LINK:
      centered("Connecting to Neddy", 180, 3, cWhite);
      break;
    case M_READY: {
      if (saying.length()) {
        // What Neddy last said stays on screen (the speaker may be off or broken).
        gfx->fillCircle(LCD_WIDTH / 2, 60, 28, cGreen);
        centered(deviceName, 104, 3, cWhite);
        centered("Hold BOOT to talk", 138, 2, cTeal);
        String tail = saying;
        if (tail.length() > 235) tail = String("...") + tail.substring(tail.length() - 232);
        wrapped(tail, 24, 172, LCD_WIDTH - 48, 2, cWhite, 5);
      } else {
        gfx->fillCircle(LCD_WIDTH / 2, 150, 48, cGreen);
        centered(deviceName, 240, 4, cWhite);
        centered("Hold BOOT to talk", 310, 3, cTeal);
      }
      centered(resetWhy, 332, 2, cGrey);
      {
        char drops[48];
        if (wsDrops && wsBackMs >= 0) snprintf(drops, sizeof(drops), "link drops %d, back in %.1f s", wsDrops, wsBackMs / 1000.0);
        else snprintf(drops, sizeof(drops), "link drops %d", wsDrops);
        centered(String(drops), 352, 2, cGrey);
      }
      centered(micChip + ", Wi-Fi " + String(WiFi.RSSI()) + " dBm", 374, 2, cGrey);
      if (lastPress.length()) centered(lastPress, 400, 2, cGrey);
      if (lastPress2.length()) centered(lastPress2, 424, 2, cGrey);
      if (lastPress3.length()) centered(lastPress3, 288, 2, cGrey);
      if (lastPress4.length()) centered(lastPress4, 310, 2, cGrey);
      if (lastAnswerMs >= 0) {
        char buf[48];
        snprintf(buf, sizeof(buf), "last answer %.1f s after release", lastAnswerMs / 1000.0);
        centered(String(buf), 450, 2, cGrey);
      }
      break;
    }
    case M_LISTEN:
      gfx->fillCircle(LCD_WIDTH / 2, 150, 48, cRed);
      centered("Listening", 240, 4, cWhite);
      centered("Let go when you're done", 310, 2, cGrey);
      drawLevel(0);
      break;
    case M_THINK:
      gfx->fillCircle(LCD_WIDTH / 2, 150, 48, cAmber);
      centered("Thinking", 240, 4, cWhite);
      if (lastPress.length()) centered(lastPress, 320, 2, cGrey);
      if (lastPress2.length()) centered(lastPress2, 344, 2, cGrey);
      if (lastPress3.length()) centered(lastPress3, 368, 2, cGrey);
      if (lastPress4.length()) centered(lastPress4, 392, 2, cGrey);
      break;
    case M_SPEAK:
      gfx->fillCircle(LCD_WIDTH / 2, 90, 36, cTeal);
      centered("Neddy", 150, 3, cWhite);
      break;
    default:
      break;
  }
}

static void screenSpeech() {
  if (millis() - lastSpeechDraw < 250) return;
  lastSpeechDraw = millis();
  gfx->fillRect(0, 200, LCD_WIDTH, 290, cBlack);
  String tail = saying;
  if (tail.length() > 220) tail = String("...") + tail.substring(tail.length() - 217);
  wrapped(tail, 24, 205, LCD_WIDTH - 48, 3, cWhite, 11);
}

// (An int, not Mode: the Arduino IDE writes a list of function names above the file's first line, before
// Mode exists, and a function using Mode there doesn't compile.)
static void setMode(int next) {
  if ((int)mode == next) return;
  mode = (Mode)next;
  Serial.printf("[mode] %d\n", (int)next);
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
    Serial.println("[mic] no ES7210 answered at 0x40-0x43");
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
  Serial.printf("[mic] ES7210 at 0x%02X, %d failed writes\n", addr, bad);
  return bad == 0;
}

static bool audioInit() {
  i2s.setPins(41, 45, 40, 42, 16);  // mclk, bclk, ws, data out, data in (Waveshare's example)
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    Serial.println("[audio] I2S failed to start");
    return false;
  }
  i2s.setTimeout(100);  // a read that finds no sound gives up quickly instead of freezing everything
  Wire.begin(IIC_SDA, IIC_SCL);
  pinMode(46, OUTPUT);
  digitalWrite(46, PLAY_ANSWERS ? HIGH : LOW);  // speaker amplifier
  if (codecInit() != ESP_OK) {
    Serial.println("[audio] audio chip setup failed");
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

static void startTalking() {
  if (!wsUp) return;
  held = true;
  pressStart = millis();
  saying = "";
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
  Serial.println("[talk] start");
}

static void stopTalking() {
  if (!held) return;
  held = false;
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
    maxLoop = maxWs = maxIdle = maxStart = blockedMs = blockedPrev = 0;
    blockedWhy = '-';
    Serial.printf("[talk] %s, %s, %s, %s\n", note, note2, note3, note4);
  }
  waitingFirstSound = true;
  setMode(M_THINK);
  Serial.println("[talk] end");
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
    drawLevel(constrain((int)(peak * 100 / 12000), 0, 100));
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
  if (mode == M_READY && millis() - lastIdleDraw > 150) {
    lastIdleDraw = millis();
    drawIdleLevel(constrain((int)(100.0f * sqrtf((float)peak / 20000.0f)), 0, 100));
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
      Serial.println("[neddy] connected");
      if (wsDropAt) wsBackMs = (long)(millis() - wsDropAt);
      wsUp = true;
      wsFailures = 0;
      static String info = String("{\"type\":\"device.info\",\"firmware\":\"") + FIRMWARE_VERSION + "\"}";
      ws.sendTXT(info.c_str());
      setMode(M_READY);
      break;
    case WStype_DISCONNECTED:
      if (wsUp) {
        Serial.println("[neddy] disconnected");
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
        Serial.printf("[state] %s\n", value.c_str());
        if (value == "speaking" && !held) setMode(M_SPEAK);
        else if (value == "thinking" && !held) setMode(M_THINK);
        else if (value == "idle" && !held && mode != M_LISTEN) setMode(M_READY);
      } else if (kind == "playback.clear") {
        flushPlayback = true;
      } else if (kind == "session.output_transcript.delta") {
        saying += plain(jsonString(text, "delta"));
        if (mode == M_SPEAK) screenSpeech();
        else if (mode == M_READY && millis() - lastSpeechDraw > 500) {
          lastSpeechDraw = millis();
          screenState();
        }
      } else if (kind == "latency") {
        Serial.printf("[latency] server says %s ms\n", text.c_str());
      } else if (kind == "error") {
        String message = plain(jsonString(text, "message"));
        Serial.printf("[error] %s\n", message.c_str());
        problem = message;
        if (!held) {
          screenProblem("Neddy says", message);
          mode = M_PROBLEM;
          problemUntil = millis() + 5000;  // the loop puts the normal screen back
        }
      } else if (kind == "session.closed") {
        Serial.println("[neddy] the call ended");
        if (!held && mode != M_LISTEN) setMode(M_READY);
      }
      break;
    }
    case WStype_BIN:
      if (waitingFirstSound) {
        waitingFirstSound = false;
        lastAnswerMs = (long)(millis() - releasedAt);
        Serial.printf("[latency] first sound %ld ms after release\n", lastAnswerMs);
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
    Serial.printf("[wifi] joined, address %s\n", WiFi.localIP().toString().c_str());
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
      Serial.printf("[pair] couldn't get a code (status %d): %s\n", status, answer.c_str());
      screenProblem("Can't reach Neddy",
                    String("Checking again in a few seconds. (code ") + status + ")");
      delay(6000);
      if (WiFi.status() != WL_CONNECTED) return false;
      continue;
    }
    Serial.printf("[pair] show code %s\n", code.c_str());
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
            Serial.println("[pair] paired!");
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
  Serial.println("\nNeddy device " FIRMWARE_VERSION);
  bootCount++;
  resetWhy = String("start ") + bootCount + ": " + resetName((int)esp_reset_reason());
  Serial.println(resetWhy);
  pinMode(BUTTON, INPUT_PULLUP);

  if (!gfx->begin()) Serial.println("[screen] gfx->begin() failed");
  makeColours();
  screenBoot("Starting");

  prefs.begin("neddy", false);
  // Hold BOOT while plugging in to forget the pairing and start over.
  if (digitalRead(BUTTON) == LOW) {
    delay(1500);
    if (digitalRead(BUTTON) == LOW) {
      prefs.remove("token");
      prefs.remove("name");
      screenBoot("Pairing cleared");
      Serial.println("[pair] cleared");
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

  // 4. The button
  bool down = buttonDown();
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
}
