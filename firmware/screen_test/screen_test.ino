// screen_test: checks the Waveshare ESP32-S3-Touch-AMOLED-1.75C's screen on its own (Waveshare's 01_HelloWorld,
// with the pins written in so it needs no extra library). It also shows what the power chip (AXP2101) says.
// Arduino IDE: same Tools settings as Neddy (ESP32S3 Dev Module, USB CDC On Boot Enabled, Flash 32MB, OPI PSRAM).
#include <Arduino.h>
#include <Wire.h>
#include "Arduino_GFX_Library.h"

Arduino_DataBus *bus = new Arduino_ESP32QSPI(12 /* CS */, 38 /* SCK */, 4, 5, 6, 7);
Arduino_CO5300 *gfx = new Arduino_CO5300(bus, 1 /* RST */, 0, 466, 466, 6, 0, 0, 0);

static int pmu(uint8_t reg) {   // one byte from the power chip, or -1
  Wire.beginTransmission(0x34);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((uint8_t)0x34, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(15, 14);
  if (!gfx->begin()) Serial.println("gfx->begin() failed");
  gfx->fillScreen(RGB565_BLACK);
  gfx->setBrightness(200);
  gfx->setTextSize(3);
  gfx->setTextColor(RGB565_WHITE);
  gfx->setCursor(110, 140);
  gfx->println("Screen test");
  gfx->setTextSize(2);
  gfx->setCursor(90, 200);
  int s0 = pmu(0x00), s1 = pmu(0x01), hi = pmu(0x34), lo = pmu(0x35);
  if (s0 < 0) {
    gfx->println("power chip: no answer");
  } else {
    int mv = ((hi & 0x3F) << 8) | lo;
    gfx->printf("power chip ok: %02X %02X\n", s0, s1);
    gfx->setCursor(90, 230);
    gfx->printf("battery %d mV %s\n", mv, (s0 & 0x08) ? "" : "(none?)");
    gfx->setCursor(90, 260);
    gfx->printf("USB power %s\n", (s0 & 0x20) ? "yes" : "no");
  }
}

void loop() {
  static int n = 0;
  gfx->fillRect(150, 320, 170, 30, RGB565_BLACK);
  gfx->setCursor(150, 320);
  gfx->setTextColor(RGB565_YELLOW);
  gfx->printf("alive %d", n++);
  Serial.printf("alive %d\n", n);
  delay(1000);
}
