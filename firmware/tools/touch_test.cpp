// Tests of the watch's touch behaviour on a computer: scripted fingers go through uiTouch (the same code the watch runs)
// and the results are checked. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/touch_test.cpp -o /tmp/touch_test && /tmp/touch_test
#include <cstdio>
#include <cstdlib>
#include "neddy_ui.h"

static uint16_t fb[UI_W * UI_H];
static void simBlit(int x, int y, int w, int h, uint16_t *px) {
  for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) if (x + c >= 0 && x + c < UI_W && y + r >= 0 && y + r < UI_H) fb[(y + r) * UI_W + x + c] = px[r * w + c];
}
static long fillsAbove = 0;   // fills that start above the diagnostic band (y < 450)
static void simFill(int x, int y, int w, int h, uint16_t col) {
  if (y < 450) fillsAbove++;
  for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) if (x + c >= 0 && x + c < UI_W && y + r >= 0 && y + r < UI_H) fb[(y + r) * UI_W + x + c] = col;
}
static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

static uint32_t now = 1000;
static void frame() { uiTick(now); }
// A finger: touches at (x,y), stays for `ms` (sampled every 16 ms), lifts.
static void finger(int x, int y, uint32_t ms, int x2 = -1, int y2 = -1) {
  if (x2 < 0) { x2 = x; y2 = y; }
  uint32_t steps = ms / 16 + 1;
  for (uint32_t i = 0; i < steps; i++) {
    int cx = x + (x2 - x) * (int)i / (int)steps, cy = y + (y2 - y) * (int)i / (int)steps;
    uiTouch(now, true, cx, cy); frame(); now += 16;
  }
  uiTouch(now, false, x2, y2); frame(); now += 16;
}
static void pause(uint32_t ms) { for (uint32_t i = 0; i < ms / 16; i++) { uiTouch(now, false, 0, 0); frame(); now += 16; } }

int main() {
  uiOut.blit = simBlit; uiOut.fill = simFill;
  uiMotion = true; uiMode = UI_READY; uiAll = true; uiNextBlink = 999999; uiNextGlance = 999999;
  frame();
  int nx = uiStageX + uiStageW / 2, ny = uiStageY + uiStageH / 2;      // the middle of Neddy (big layout)

  // A tap on Neddy: he giggles, nothing else.
  finger(nx, ny, 100);
  CHECK(now < uiReactUntil + 200 && uiReactUntil > 0, "tap makes him giggle");
  CHECK(!uiTouchTalk, "a single tap doesn't talk");
  UiPose p; uiPoseNow(uiReactUntil - 500, &p);
  CHECK(p.eye == EYE_HAPPY, "giggling eyes are the happy ones");
  pause(1300);
  CHECK(!uiTouchTalk, "still not talking after the giggle");

  // Hold Neddy: talking while held, stops when the finger lifts.
  uiTouch(now, true, nx, ny); frame(); uint32_t t0 = now;
  while (now - t0 < 300) { now += 16; uiTouch(now, true, nx, ny); frame(); }
  CHECK(!uiTouchTalk, "not yet at 300 ms");
  while (now - t0 < 520) { now += 16; uiTouch(now, true, nx, ny); frame(); }
  CHECK(uiTouchTalk, "holding Neddy talks");
  uiTouch(now, false, nx, ny); frame(); now += 16;
  CHECK(!uiTouchTalk, "letting go stops talking");
  pause(600);

  // A finger that moves while down is not a hold.
  uiTouch(now, true, nx, ny); t0 = now;
  while (now - t0 < 700) { now += 16; uiTouch(now, true, nx + (int)((now - t0) / 8), ny); frame(); }
  CHECK(!uiTouchTalk, "a moving finger doesn't talk");
  uiTouch(now, false, nx + 90, ny); now += 16; pause(600);

  // Double tap: talks hands-free until the next touch.
  finger(nx, ny, 60); now += 150;
  finger(nx, ny, 60);
  CHECK(uiTouchTalk, "double tap starts hands-free talking");
  pause(2000);
  CHECK(uiTouchTalk, "and keeps listening with no finger down");
  finger(nx, ny, 50);
  CHECK(!uiTouchTalk, "the next touch ends it");
  pause(700);
  // That ending touch isn't also a tap that starts something.
  CHECK(!uiTouchTalk, "and doesn't start another");

  // The sketch ending talking (the time limit) lets go too.
  finger(nx, ny, 60); now += 150; finger(nx, ny, 60);
  CHECK(uiTouchTalk, "hands-free again");
  uiTouchTalkEnded();
  CHECK(!uiTouchTalk, "the sketch can end it");
  pause(700);

  // Eyes follow a finger on Neddy.
  uiTouch(now, true, nx + 80, ny - 60); frame(); now += 16; uiTouch(now, true, nx + 80, ny - 60); frame();
  uiPoseNow(now, &p);
  CHECK(p.eyeDx > 2.0f, "eyes look toward a finger on the right");
  uiTouch(now, false, nx + 80, ny - 60); frame(); now += 16;
  pause(900);

  // Cards: tap dismisses; touches elsewhere do nothing.
  uiShowWeather(now, "Houston", 72, UI_NONE, "Sunny", UI_ICON_SUN, 80, 65, 0, "");
  frame();
  CHECK(uiCard.on, "card is up");
  finger(30, 480, 50);
  CHECK(uiCard.on, "a touch outside the card and Neddy does nothing");
  finger(205, 150, 60);
  CHECK(!uiCard.on, "tap on the card dismisses it");
  pause(300);

  // Swipes: three cards, browse back and forward, and bring one back when none is up.
  uiShowScore(now, "NBA", "Final", "Lakers", 98, "Suns", 101); frame(); pause(100);
  uiShowFact(now, "AAPL", "$187.42", "+1.2%", "", 1); frame(); pause(100);
  CHECK(uiCard.kind == UI_CARD_FACT && uiHistN == 3, "three cards remembered, the fact is up");
  finger(100, 200, 120, 300, 205);                                   // swipe right
  CHECK(uiCard.on && uiCard.kind == UI_CARD_SCORE, "swipe right shows the earlier card");
  finger(100, 200, 120, 300, 205);
  CHECK(uiCard.kind == UI_CARD_WEATHER, "again: the one before that");
  finger(100, 200, 120, 300, 205);
  CHECK(uiCard.kind == UI_CARD_WEATHER, "at the oldest it stays");
  finger(300, 200, 120, 100, 205);                                   // swipe left
  CHECK(uiCard.kind == UI_CARD_SCORE, "swipe left goes forward");
  finger(205, 150, 60);                                              // dismiss
  CHECK(!uiCard.on, "dismissed");
  pause(300);
  finger(100, 200, 120, 300, 205);
  CHECK(uiCard.on, "a swipe with no card up brings one back");
  // A short drag is not a swipe, and a slow long one is neither.
  int before = uiCard.kind;
  finger(150, 200, 100, 180, 205);
  CHECK(uiCard.kind == before, "a short drag changes nothing");
  // Only the last five are kept.
  for (int i = 0; i < 7; i++) { uiShowFact(now, "N", "1", "", "", 0); uiCard.rows = i; uiRemember(); }
  CHECK(uiHistN == UI_HIST, "only five are kept");

  // A new press (listening) clears the card, as before.
  uiShowWeather(now, "Houston", 72, UI_NONE, "Sunny", UI_ICON_SUN, 80, 65, 0, "");
  uiSetMode(UI_LISTEN);
  CHECK(!uiCard.on, "listening clears the card");

  // The watch's own diagnostic lines (Wi-Fi strength, timings) change every second; that must not count as someone using it,
  // or the idle face never comes (found on the real board: the quiet timer kept restarting).
  static int level = -1;
  uiOut.brightness = [](int l) { level = l; };
  uiClearCard(); uiSetMode(UI_READY);
  uiIdle.have = true; uiIdle.after = 20; uiIdle.dim = true; uiIdle.baseUtc = 1800000000; uiIdle.baseMs = now; uiIdle.off = 0;
  uiSetWords(""); uiSetHeard(""); uiActivity(now);
  for (int sec = 0; sec < 25; sec++) {
    char a[40]; snprintf(a, sizeof(a), "Wi-Fi -%d dBm", 40 + sec);
    uiSetDiag(a, "line two"); pause(1000);
  }
  CHECK(uiIdleOn, "the idle face comes even while the diagnostic lines keep changing");
  for (int sec = 0; sec < 70; sec++) {
    char a[40]; snprintf(a, sizeof(a), "Wi-Fi -%d dBm", 40 + sec % 9);
    uiSetDiag(a, "line two"); pause(1000);
  }
  CHECK(uiDimmed && level == UI_DIM_LEVEL, "it dims a minute after the idle face came");
  uiTouch(now, true, 100, 100); frame(); now += 16; uiTouch(now, false, 100, 100); frame();
  CHECK(!uiIdleOn && !uiDimmed && level == 255, "a touch wakes it and restores the brightness");

  // The diagnostic lines change every second. They must never make the words blink (the whole text area redrawn), shown or not.
  uiOut.brightness = nullptr;
  uiIdle.have = false; uiIdleOn = false; uiClearCard(); uiSetMode(UI_READY); uiSetWords("Hold BOOT to talk"); pause(500);
  for (int shown = 0; shown < 2; shown++) {
    uiShowDiag = shown == 1;
    pause(1000);
    long before = fillsAbove;
    for (int sec = 0; sec < 10; sec++) {
      char a[40]; snprintf(a, sizeof(a), "Wi-Fi -%d dBm", 50 + sec);
      uiSetDiag(a, "line two"); pause(1000);
    }
    CHECK(fillsAbove == before, shown ? "changing diagnostic lines don't redraw the words (shown)" : "changing diagnostic lines don't redraw the words (hidden)");
  }
  uiShowDiag = false;

  // A card stays as long as the idle wait (10 s by default), then the face comes back right away; with the face off it lasts a minute.
  uiIdle.have = true; uiIdle.after = 10; uiIdle.dim = true; uiIdle.baseUtc = 1800000000; uiIdle.baseMs = now; uiIdle.off = 0;
  uiClearCard(); uiSetMode(UI_READY); uiSetWords(""); uiSetHeard(""); uiActivity(now); pause(300);
  uiShowFact(now, "Fact", "1", "", "", 0);
  pause(9000);
  CHECK(uiCard.on && !uiIdleOn, "the card is still up at 9 s");
  pause(1500);
  CHECK(!uiCard.on && uiIdleOn, "at 10 s the card goes and the face is back at once");
  uiActivity(now); uiIdle.after = 0; uiClearCard();
  uiShowFact(now, "Fact", "1", "", "", 0);
  pause(30000);
  CHECK(uiCard.on, "with the face off a card still lasts a minute");
  pause(31000);
  CHECK(!uiCard.on, "and goes after a minute");
  uiIdle.after = 10;

  // The menu: the PWR button (uiMenuOpen) or a swipe up from the bottom edge opens big tiles; tap one.
  static int setKey = -1, setVal = -1;
  uiOut.setting = [](int k, int v) { setKey = k; setVal = v; };
  uiOut.brightness = [](int l) { level = l; };
  uiIdle.have = false; uiIdleOn = false; uiDimmed = false; uiClearCard(); uiSetMode(UI_READY); uiSetWords(""); uiSetHeard(""); uiMotion = true; uiActivity(now); pause(300);
  uiMenuOpen(now);
  CHECK(uiCard.on && uiCard.kind == UI_CARD_MENU, "the PWR button opens the menu");
  uiMenuOpen(now);
  CHECK(!uiCard.on, "the PWR button again closes it");
  uiClearCard(); uiHistN = 0;
  finger(200, 460, 200, 200, 330);                                   // a swipe up from the bottom edge
  CHECK(uiCard.on && uiCard.kind == UI_CARD_MENU, "a swipe up from the bottom edge opens the menu");
  int tx, ty; uiMenuTileRect(0, &tx, &ty);
  finger(tx + 88, ty + 74, 60);
  CHECK(uiFpsLevel == 2 && setKey == UI_SET_ANIM && setVal == 2 && uiCard.on, "tapping Animation goes normal -> smooth and tells the server");
  finger(tx + 88, ty + 74, 60); finger(tx + 88, ty + 74, 60);
  CHECK(uiFpsLevel == 1 && setVal == 1, "and round again to normal");
  uiShowFact(now, "Fact", "1", "", "", 0); uiMenuOpen(now);       // a card behind: swiping must not flip it away
  uiMenuOpen(now);
  CHECK(uiCard.kind == UI_CARD_FACT || uiCard.kind == UI_CARD_MENU, "a card and the menu don't mix up");
  uiClearCard(); uiMenuOpen(now);
  finger(300, 200, 200, 80, 330);
  finger(100, 200, 330, 200, 330);
  CHECK(uiCard.on && uiCard.kind == UI_CARD_MENU, "swiping sideways doesn't flip through cards while the menu is open");
  finger(200, 60, 60);
  CHECK(!uiCard.on, "tapping beside the tiles closes the menu");
  uiMenuOpen(now);
  pause(14000);
  CHECK(uiCard.on, "the menu is still there at 14 s");
  pause(1500);
  CHECK(!uiCard.on, "and goes after 15 s of quiet");
  uiMenuOpen(now); uiMenuTileRect(1, &tx, &ty);
  finger(tx + 88, ty + 74, 60);
  CHECK(!uiCard.on && uiScreenOff && level == 0, "Screen off darkens the screen");
  finger(200, 200, 60);
  CHECK(!uiScreenOff && level == 255, "a touch wakes it at full brightness");
  // The animation level sets how often Neddy is drawn (the test loop runs about 60 times a second).
  uiClearCard(); uiIdle.have = false; uiMotion = true; uiNextBlink = 999999; uiNextGlance = 999999;
  for (int lv = 0; lv < 3; lv++) {
    uiFpsLevel = lv; pause(2200);
    int f = uiFpsNow;
    if (lv == 0) CHECK(f >= 5 && f <= 9, "saver draws about 8 frames a second");
    if (lv == 1) CHECK(f >= 13 && f <= 17, "normal draws about 16 frames a second");
    if (lv == 2) CHECK(f >= 19, "smooth draws more");
  }
  uiFpsLevel = 1;

  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
