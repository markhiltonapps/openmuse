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
#include "es8311.h"
#include "settings.h"

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
static void centered(const String &text, int y, int size, uint16_t colour) {
  int w = text.length() * 6 * size;
  int x = (LCD_WIDTH - w) / 2;
  if (x < 4) x = 4;
  gfx->setTextSize(size);
  gfx->setTextColor(colour);
  gfx->setCursor(x, y);
  gfx->print(text);
}

// Wrapped text inside a box (left, top, width), broken at spaces.
static void wrapped(const String &text, int left, int top, int width, int size, uint16_t colour,
                    int maxLines) {
  int perLine = width / (6 * size);
  if (perLine < 4) perLine = 4;
  gfx->setTextSize(size);
  gfx->setTextColor(colour);
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
    gfx->setCursor(left, y);
    gfx->print(line);
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
      out += (n == 'n') ? ' ' : n;
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
      gfx->fillCircle(LCD_WIDTH / 2, 150, 48, cGreen);
      centered(deviceName, 240, 4, cWhite);
      centered("Hold BOOT to talk", 310, 3, cTeal);
      if (lastPress.length()) centered(lastPress, 400, 2, cGrey);
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

static bool audioInit() {
  i2s.setPins(41, 45, 40, 42, 16);  // mclk, bclk, ws, data out, data in (Waveshare's example)
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    Serial.println("[audio] I2S failed to start");
    return false;
  }
  Wire.begin(IIC_SDA, IIC_SCL);
  pinMode(46, OUTPUT);
  digitalWrite(46, HIGH);  // speaker amplifier on
  if (codecInit() != ESP_OK) {
    Serial.println("[audio] audio chip setup failed");
    return false;
  }
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
      stereo[2 * i] = mono[i];
      stereo[2 * i + 1] = mono[i];
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
  // Sound still playing from a last answer is cut off, as when you talk over someone.
  flushPlayback = true;
  ws.sendTXT("{\"type\":\"ptt.start\"}");
  setMode(M_LISTEN);
  // Throw away what the microphone heard before the press.
  static uint8_t trash[1280];
  for (int i = 0; i < 2; i++) i2s.readBytes((char *)trash, sizeof(trash));  // about 40 ms of old sound
  Serial.println("[talk] start");
}

static void stopTalking() {
  if (!held) return;
  held = false;
  ws.sendTXT("{\"type\":\"ptt.end\"}");
  releasedAt = millis();
  {
    char note[64];
    snprintf(note, sizeof(note), "sent %ld ms, mic peak %ld", pressBytes / 32, pressPeak);
    lastPress = note;
    Serial.printf("[talk] %s, %ld empty reads\n", note, pressMisses);
  }
  waitingFirstSound = true;
  setMode(M_THINK);
  Serial.println("[talk] end");
}

// Reads 20 ms of microphone sound, makes it mono (takes the louder of the two channels), sends it.
static void sendMicChunk() {
  static int16_t stereo[640];  // 320 frames of 2 x 16-bit = 20 ms
  static int16_t mono[320];
  size_t got = i2s.readBytes((char *)stereo, sizeof(stereo));
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
  ws.sendBIN((uint8_t *)mono, frames * 2);
  pressBytes += frames * 2;
  if (peak > pressPeak) pressPeak = peak;
  if (millis() - lastLevelDraw > 100) {
    lastLevelDraw = millis();
    drawLevel(constrain((int)(peak * 100 / 12000), 0, 100));
  }
}

// ---------------------------------------------------------------- the connection to Neddy
static void onSocket(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[neddy] connected");
      wsUp = true;
      wsFailures = 0;
      static String info = String("{\"type\":\"device.info\",\"firmware\":\"") + FIRMWARE_VERSION + "\"}";
      ws.sendTXT(info.c_str());
      setMode(M_READY);
      break;
    case WStype_DISCONNECTED:
      if (wsUp) Serial.println("[neddy] disconnected");
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
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(15000, 4000, 2);
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
  ws.loop();

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
  if (down && !held && wsUp && mode != M_PROBLEM) startTalking();
  if (held) {
    if (!down || millis() - pressStart > (unsigned long)MAX_TALK_SECONDS * 1000UL) stopTalking();
    else sendMicChunk();
  }
}
