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
static long fillsAbove = 0;   // fills that start above the diagnostic band (y < UI_DIAG_Y)
static void simFill(int x, int y, int w, int h, uint16_t col) {
  if (y < UI_DIAG_Y - 2) fillsAbove++;
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
  uiTouch(now, false, 0, 0); frame(); now += 16;   // the touch chip gives no position once the finger is up (the sketch passes 0,0)
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
#if NEDDY_ROUND
  finger(UI_CX, UI_H - 60, 50);
  CHECK(!uiCard.on, "(round) a card fills the circle, so a tap anywhere closes it");
  uiShowFromHistory(now, uiHistN - 1); frame();               // (the same card back, without remembering it twice)
#else
  finger(30, 480, 50);
  CHECK(uiCard.on, "a touch outside the card and Neddy does nothing");
#endif
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

  // Raise-to-wake: a raised wrist brightens a dimmed idle face and keeps it (the clock stays), starts the dimming wait again,
  // does nothing to a screen that is already bright, and never turns on a screen that was switched off from the menu.
  for (int sec = 0; sec < 95; sec++) pause(1000);
  CHECK(uiIdleOn && uiDimmed && level == UI_DIM_LEVEL, "(raise) the idle face is up and dimmed again");
  CHECK(uiWantsRaise(), "a dimmed idle face wants a raise");
  int raisesBefore = uiRaises;
  uiRaise(now);
  CHECK(!uiDimmed && uiIdleOn && level == 255 && uiRaises == raisesBefore + 1, "a raise brightens the dimmed idle face and the clock stays");
  CHECK(!uiWantsRaise(), "a bright screen wants nothing");
  level = 99; uiRaise(now);
  CHECK(level == 99 && uiRaises == raisesBefore + 1, "a raise on a bright screen changes nothing");
  for (int sec = 0; sec < 55; sec++) pause(1000);
  CHECK(!uiDimmed, "still bright 55 s after a raise");
  for (int sec = 0; sec < 10; sec++) pause(1000);
  CHECK(uiDimmed && level == UI_DIM_LEVEL, "it dims again a minute after the raise");
  uiScreenOff = true; level = 7;
  CHECK(!uiWantsRaise(), "a screen switched off wants no raise");
  uiRaise(now);
  CHECK(uiScreenOff && level == 7, "a raise never turns on a screen that was switched off");
  uiActivity(now); uiDimmed = false; uiIdleOn = false; pause(100);

  // "Dim after N seconds" (here 5 of quiet, the idle face coming after 20): it dims the moment the idle face is up, a raise brightens it,
  // and it dims again 5 s after that. 0 goes back to the usual minute after the idle face came.
  uiIdle.dimAfter = 5; uiActivity(now);
  for (int sec = 0; sec < 22; sec++) pause(1000);
  CHECK(uiIdleOn && uiDimmed && level == UI_DIM_LEVEL, "with dim-after 5 the idle face comes up dimmed");
  uiRaise(now);
  CHECK(!uiDimmed && uiIdleOn && level == 255, "a raise brightens it");
  for (int sec = 0; sec < 4; sec++) pause(1000);
  CHECK(!uiDimmed, "still bright 4 s later");
  for (int sec = 0; sec < 2; sec++) pause(1000);
  CHECK(uiDimmed, "dimmed again after 5 s of quiet");
  uiIdle.dimAfter = 0; uiActivity(now); uiDimmed = false; uiIdleOn = false; pause(100);
  for (int sec = 0; sec < 40; sec++) pause(1000);
  CHECK(uiIdleOn && !uiDimmed, "with dim-after 0 it keeps the usual minute (idle face up, not dimmed yet)");
  uiActivity(now); uiDimmed = false; uiIdleOn = false; pause(100);

  // Battery saver: the idle face dims after 15 s to a much lower level, goes fully dark 45 s later by itself, and a touch, words or a raise of the wrist wake it.
  uiSaver = true; uiIdle.dimAfter = 0; uiActivity(now); uiDimmed = false; uiIdleOn = false; level = 255; pause(100);
  for (int sec = 0; sec < 22; sec++) pause(1000);                    // the idle face comes after 20 s of quiet
  CHECK(uiIdleOn && !uiDimmed, "(saver) the idle face is up and still bright just after it came");
  for (int sec = 0; sec < 15; sec++) pause(1000);
  CHECK(uiDimmed && level == UI_SAVER_DIM_LEVEL && !uiScreenOff, "(saver) it dims about 15 s after the idle face, to the low level");
  for (int sec = 0; sec < 40; sec++) pause(1000);
  CHECK(uiDimmed && !uiScreenOff && level == UI_SAVER_DIM_LEVEL, "(saver) still dim 40 s later");
  for (int sec = 0; sec < 10; sec++) pause(1000);
  CHECK(uiScreenOff && uiScreenOffAuto && level == 0, "(saver) 45 s after dimming the screen goes dark by itself");
  CHECK(uiWantsRaise(), "(saver) while dark by itself the watch still listens for a raise");
  uiRaise(now);
  CHECK(!uiScreenOff && !uiScreenOffAuto && !uiDimmed && level == 255, "(saver) a raise of the wrist wakes a screen that went dark by itself");
  for (int sec = 0; sec < 70; sec++) pause(1000);
  CHECK(uiScreenOff && uiScreenOffAuto, "(saver) and it goes dark again after the same waits");
  uiTouch(now, true, 100, 100); frame(); now += 16; uiTouch(now, false, 100, 100); frame();
  CHECK(!uiScreenOff && level == 255, "(saver) a touch wakes it too");
  uiScreenOff = true; uiScreenOffAuto = false; level = 7; uiDimmed = true;
  CHECK(!uiWantsRaise(), "(saver) the menu's Screen off is not woken by a raise");
  uiRaise(now);
  CHECK(uiScreenOff && level == 7, "(saver) a raise never wakes the menu's Screen off");
  uiActivity(now);
  uiSaver = false; uiDimmed = false; uiIdleOn = false; level = 255; pause(100);
  for (int sec = 0; sec < 40; sec++) pause(1000);
  CHECK(uiIdleOn && !uiDimmed && !uiScreenOff, "(saver off) the old timing: nothing dims 20 s after the idle face, and the screen never goes dark by itself");
  uiActivity(now); uiDimmed = false; uiIdleOn = false; pause(100);

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

  // The launcher (the PWR button, or a swipe up from the bottom edge): Neddy in the middle, icons round him; tap one.
  static int setKey = -1, setVal = -1, recAsked = 0, actAsked = 0;
  uiOut.setting = [](int k, int v) { setKey = k; setVal = v; };
  uiOut.brightness = [](int l) { level = l; };
  uiOut.record = [](int a) { if (a == UI_REC_START) recAsked++; };
  uiOut.action = [](int a) { actAsked = a; };
  auto icon = [](int i, int *x, int *y) { float fx, fy; uiLauncherPos(i, &fx, &fy); *x = (int)fx; *y = (int)fy; };
  auto arcPoint = [](float deg, int *x, int *y) { *x = (int)(UI_CX + UI_ARC_R * cosf(deg * 0.0174533f)); *y = (int)(uiArcCY() + UI_ARC_R * sinf(deg * 0.0174533f)); };
  int tx, ty;
  uiIdle.have = false; uiIdleOn = false; uiDimmed = false; uiClearCard(); uiSetMode(UI_READY); uiSetWords(""); uiSetHeard(""); uiMotion = true; uiActivity(now); pause(300);
  uiDoublePress = 2;                                               // (no double-press action: a single press acts at once)
  uiPwrPress(now);
  CHECK(uiMenuOn() && uiShl == UI_SHL_HOME, "the PWR button opens the launcher");
  uiPwrPress(now);
  CHECK(!uiCard.on, "the PWR button again closes it");
  uiClearCard(); uiHistN = 0;
  finger(UI_CX, UI_H - 40, 200, UI_CX, UI_H - 180);                // a swipe up from the bottom edge
  CHECK(uiMenuOn(), "a swipe up from the bottom edge opens the launcher");
  finger(UI_CX, UI_CY, 60);
  CHECK(!uiCard.on, "tapping Neddy in the middle closes it");
  // Settings: the sliders icon; one setting a page, swiped sideways.
  uiMenuOpen(now); icon(UI_L_SETTINGS, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiMenuOn() && uiShl == UI_SHL_SET && uiShlPage == UI_PG_BRIGHT, "the sliders icon opens Settings on Brightness");
  setKey = -1; int ax, ay, bx, by;
  uiBright = 100; arcPoint(90, &ax, &ay); arcPoint(100, &bx, &by);
  finger(ax, ay, 300, bx, by);
  CHECK(uiBright == 100 && setKey == -1 && uiShlPage == UI_PG_BRIGHT, "a finger that starts away from the knob doesn't move it");
  arcPoint(30, &ax, &ay); arcPoint(90, &bx, &by);                  // the knob at 100% sits at the arc's right end
  finger(ax, ay, 300, bx, by);
  CHECK(uiBright >= 45 && uiBright <= 55 && setKey == UI_SET_BRIGHT && setVal == uiBright, "dragging along the arc to its bottom sets about half brightness, told once on lifting");
  CHECK(level == uiFullLevel(), "and the screen follows as it moves");
  finger(UI_CX + 100, UI_CY - 60, 200, UI_CX - 100, UI_CY - 60);   // swipe left: the next page
  CHECK(uiShl == UI_SHL_SET && uiShlPage == UI_PG_VOLUME, "a swipe to the left shows the next setting (Volume)");
  uiVolume = 50; arcPoint(90, &ax, &ay); arcPoint(30, &bx, &by);   // the knob at 50% is at the bottom
  finger(ax, ay, 400, bx, by);
  CHECK(uiVolume == 100 && setKey == UI_SET_VOLUME && setVal == 100, "dragging to the end of the arc: volume 100");
  finger(UI_CX - 100, UI_CY - 60, 200, UI_CX + 100, UI_CY - 60);   // swipe right: back
  CHECK(uiShlPage == UI_PG_BRIGHT, "a swipe to the right goes back");
  finger(UI_CX - 100, UI_CY - 60, 200, UI_CX + 100, UI_CY - 60);
  CHECK(uiShlPage == UI_PG_BRIGHT, "and stops at the first page");
  uiShellGo(UI_SHL_SET, UI_PG_DIM); uiIdle.dim = true; uiIdle.dimAfter = 30;
  finger(UI_CX + 150, UI_CY, 60);
  CHECK(uiIdle.dimAfter == 60 && setKey == UI_SET_DIM && setVal == 60, "Dim after: plus goes 30 s -> 1 min");
  for (int i = 0; i < 6; i++) finger(UI_CX - 150, UI_CY, 60);
  CHECK(!uiIdle.dim && setVal == 0, "minus down to Never turns dimming off");
  uiShellGo(UI_SHL_SET, UI_PG_OFF); uiIdle.offAfter = 0;
  finger(UI_CX + 150, UI_CY, 60);
  CHECK(uiIdle.offAfter == 60 && setKey == UI_SET_OFF && setVal == 60, "Screen off after: plus goes Never -> 1 min");
  uiShellGo(UI_SHL_SET, UI_PG_COLOUR); uiAccentIdx = 0;
  finger(UI_CX + 48, UI_CY + 66, 60);
  CHECK(uiAccentIdx == 2 && setKey == UI_SET_ACCENT && setVal == 2, "Colour: tapping the third dot picks green");
  uiAccentIdx = 0;
  uiShellGo(UI_SHL_SET, UI_PG_SAVER); bool was = uiSaver;
  finger(UI_CX, UI_CY + 10, 60);
  CHECK(uiSaver != was && setKey == UI_SET_SAVER && setVal == (uiSaver ? 1 : 0), "Battery saver: a tap on the switch turns it over");
  finger(UI_CX, UI_CY + 10, 60);
  CHECK(uiSaver == was, "and back");
  uiShellGo(UI_SHL_SET, UI_PG_ANIM); uiFpsLevel = 1;
  finger(UI_CX + 120, UI_CY + 66, 60);
  CHECK(uiFpsLevel == 2 && setKey == UI_SET_ANIM && setVal == 2, "Animation: the right-hand choice is Smooth");
  uiShellGo(UI_SHL_SET, UI_PG_DOUBLE); uiDoublePress = 2;
  finger(UI_CX, UI_CY + 66, 60);
  CHECK(uiDoublePress == 1 && setKey == UI_SET_DOUBLE && setVal == 1, "Double press: the middle choice is Talk");
  uiDoublePress = 2;
  finger(UI_CX + 100, UI_CY - 60, 200, UI_CX - 100, UI_CY - 60);
  CHECK(uiShlPage == UI_PG_DOUBLE, "the last page stays the last");
  uiPwrPress(now);
  CHECK(uiMenuOn() && uiShl == UI_SHL_HOME, "PWR on a settings page goes back to the launcher");
  uiPwrPress(now);
  CHECK(!uiCard.on, "and again closes it");
  // Record: the microphone icon; swipe between the four modes; HOLD the circle a second to start (a tap or PWR never starts one).
  uiRecAvailable = true; uiRecMode = 2; recAsked = 0;
  uiMenuOpen(now); icon(UI_L_RECORD, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiShl == UI_SHL_REC && uiShlPage == 2, "the microphone opens Record on the mode used last (Meeting)");
  finger(UI_CX + 100, UI_CY - 160, 200, UI_CX - 100, UI_CY - 160);
  CHECK(uiShlPage == 3, "a swipe shows Dream");
  finger(UI_CX, uiRecCircleY(), 60);
  CHECK(recAsked == 0 && uiMenuOn() && uiShl == UI_SHL_REC, "a tap on the circle starts nothing (a pocket can't start a recording)");
  CHECK(uiRecHintUntil > 0, "but HOLD TO START lights up, so the tap isn't met with nothing");
  pause(800);
  CHECK(uiRecHintUntil == 0 && uiMenuOn(), "and goes back after a moment");
  finger(UI_CX, uiRecCircleY(), 600);
  CHECK(recAsked == 0 && uiMenuOn(), "nor does letting go after half a second");
  finger(UI_CX, uiRecCircleY(), 1100);
  CHECK(recAsked == 1 && uiRecMode == 3 && !uiCard.on, "holding the circle a full second starts a Dream recording");
  uiMenuOpen(now); icon(UI_L_RECORD, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiShlPage == 3, "Record opens on the mode used last");
  finger(UI_CX - 100, UI_CY - 160, 200, UI_CX + 100, UI_CY - 160); finger(UI_CX - 100, UI_CY - 160, 200, UI_CX + 100, UI_CY - 160);
  CHECK(uiShlPage == 1, "two swipes back show Idea");
  uiPwrPress(now);
  CHECK(recAsked == 1 && uiMenuOn() && uiShl == UI_SHL_HOME, "PWR on the Record page goes back, never starts a recording");
  uiShellGo(UI_SHL_REC, 1); finger(UI_CX + 40, uiRecCircleY() + 20, 1100);
  CHECK(recAsked == 2 && uiRecMode == 1, "holding anywhere on the circle starts an Idea recording");
  uiMenuOpen(now); uiShellGo(UI_SHL_REC, 0);
  finger(UI_CX, uiRecCircleY(), 1100, UI_CX + 20, uiRecCircleY() + 6);
  CHECK(recAsked == 3 && uiRecMode == 0, "a thumb that drifts a little (20 px) while holding still starts it");
  uiMenuOpen(now); uiShellGo(UI_SHL_REC, 2);
  finger(UI_CX + 100, uiRecCircleY(), 1100, UI_CX - 100, uiRecCircleY());
  CHECK(recAsked == 3 && uiShlPage == 3, "a slow swipe that starts on the circle turns the page, it doesn't start a recording");
  uiRecAvailable = false; recAsked = 0;
  uiMenuOpen(now); icon(UI_L_RECORD, &tx, &ty); finger(tx, ty, 60); finger(UI_CX, uiRecCircleY(), 60);
  CHECK(recAsked == 0, "without recording storage nothing starts");
  uiClearCard();
  // A double press of PWR: the chosen action; a single press waits to see whether a second comes.
  uiRecAvailable = true; uiDoublePress = 0; recAsked = 0; uiRecMode = 0;
  uiPwrPress(now); now += 150; uiPwrPress(now); pause(500);
  CHECK(recAsked == 1 && !uiMenuOn(), "two quick presses start a recording in the mode used last");
  uiPwrPress(now); pause(200);
  CHECK(!uiMenuOn(), "one press waits a moment");
  pause(300);
  CHECK(uiMenuOn() && recAsked == 1, "then opens the launcher");
  uiClearCard(); uiDoublePress = 1;
  uiPwrPress(now); now += 150; uiPwrPress(now); pause(50);
  CHECK(uiTouchTalk, "with Talk chosen, two quick presses start hands-free talk");
  finger(UI_CX, 60, 60); uiTouchTalkEnded();
  uiDoublePress = 2; uiRecAvailable = false; uiClearCard();
  // Info: the battery at the top and the i icon both open it; pages up and down; Restart on the last.
  uiMenuOpen(now); icon(UI_L_INFO, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiShl == UI_SHL_INFO && uiShlPage == 0, "the i icon opens Info");
  uiClearCard(); uiMenuOpen(now); icon(UI_L_BATTERY, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiShl == UI_SHL_INFO && uiShlPage == 0, "the battery at the top opens Info too");
  finger(UI_CX, UI_CY + 100, 200, UI_CX, UI_CY - 60);
  CHECK(uiShlPage == 1, "a swipe up shows the next Info page");
  finger(UI_CX, UI_CY + 100, 200, UI_CX, UI_CY - 60);
  actAsked = 0; finger(UI_CX, UI_CY + 10, 60);
  CHECK(uiShlPage == 2 && actAsked == 0, "a tap on Restart does nothing (it's a hold)");
  finger(UI_CX, UI_CY + 10, 500);
  CHECK(actAsked == 0, "let go after half a second: still nothing");
  finger(UI_CX, UI_CY + 10, 1100);
  CHECK(uiShlPage == 2 && actAsked == UI_ACT_RESTART, "holding Restart a full second asks the watch to restart");
  uiClearCard();
  // The Watch face icon goes info -> analog -> neon -> info and tells the server; the launcher closes and the new face shows at once.
  uiIdle.have = true; uiIdle.after = 10; uiIdle.baseUtc = 1800000000; uiIdle.baseMs = now; uiSetMode(UI_READY); uiFace = 0;
  uiMenuOpen(now); icon(UI_L_FACE, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiFace == 1 && setKey == UI_SET_FACE && setVal == 1, "the clock icon goes info -> analog");
  CHECK(uiCard.on && uiCard.kind == UI_CARD_FACT && !strcmp(uiCard.sky, "Analog"), "the launcher closes and names the new face for a moment");
  pause(1400);
  CHECK(!uiCard.on && uiIdleOn, "then the new face itself shows");
  for (int i = 0; i < 2; i++) { uiMenuOpen(now); finger(tx, ty, 60); }
  CHECK(uiFace == 0 && setVal == 0, "and round again to info");
  uiClearCard();
  // The sun shows today's weather from the face's facts (or says to ask).
  uiIdle.haveW = true; uiIdle.wt = 71; uiIdle.wi = UI_ICON_SUN; strcpy(uiIdle.ws, "Sunny");
  uiMenuOpen(now); icon(UI_L_WEATHER, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiCard.on && uiCard.kind == UI_CARD_WEATHER && uiCard.temp == 71, "the sun shows today's weather card");
  uiClearCard(); uiIdle.haveW = false;
  uiMenuOpen(now); finger(tx, ty, 60);
  CHECK(uiCard.on && uiCard.kind == UI_CARD_FACT, "with no weather yet it says to ask");
  uiClearCard();
  // The calendar shows the next meeting from the face's facts (or says to ask).
  uiIdle.haveM = false; uiIdle.mc = 0;
  uiMenuOpen(now); icon(UI_L_MEETING, &tx, &ty); finger(tx, ty, 60);
  CHECK(uiCard.on && uiCard.kind == UI_CARD_FACT && !strcmp(uiCard.place, "Next meeting"), "the calendar shows the next meeting (here: ask me)");
  uiClearCard();
  // Screen off: dark at once; a touch wakes it at the person's brightness.
  uiBright = 70;
  uiMenuOpen(now); icon(UI_L_OFF, &tx, &ty); finger(tx, ty, 60);
  CHECK(!uiCard.on && !uiScreenOff, "Screen off first says so (and how to wake it) for a second");
  pause(1100);
  CHECK(uiScreenOff && level == 0, "then the screen goes dark");
  finger(UI_CX, UI_CY, 60);
  CHECK(!uiScreenOff && level == uiFullLevel() && level < 255, "a touch wakes it at the chosen brightness (70%)");
  uiBright = 100;
  // The BOOT button: a quarter-second hold talks, a tap doesn't, a double-click opens the launcher (not while recording).
  uiClearCard();
  auto boot = [](uint32_t ms) { bool talked = false; for (uint32_t t = 0; t <= ms; t += 16) { talked |= uiBoot(now, true); frame(); now += 16; } uiBoot(now, false); frame(); now += 16; return talked; };
  CHECK(!boot(120), "a short press of BOOT doesn't talk");
  pause(500);
  CHECK(!uiMenuOn(), "and one press on its own opens nothing");
  CHECK(boot(400), "holding BOOT a little talks");
  pause(500);
  boot(80); now += 100; boot(80);
  CHECK(uiMenuOn() && uiShl == UI_SHL_HOME, "a double-click of BOOT opens the launcher");
  boot(80); now += 100; boot(80);
  CHECK(!uiCard.on, "and again closes it");
  pause(500);
  boot(80); pause(600); boot(80);
  CHECK(!uiMenuOn(), "two presses far apart are two single presses");
  pause(500);
  // Holding Neddy in the launcher talks, as on his own screen.
  uiClearCard(); uiMenuOpen(now);
  for (int i = 0; i < 40; i++) { uiTouch(now, true, UI_CX, UI_CY); frame(); now += 16; }
  CHECK(uiTouchTalk && !uiMenuOn(), "holding Neddy in the launcher talks (and the launcher steps aside)");
  uiTouch(now, false, 0, 0); frame(); now += 16;
  CHECK(!uiTouchTalk, "letting go stops");
  uiMenuOpen(now);
  pause(19000);
  CHECK(uiCard.on, "the launcher is still there at 19 s");
  pause(1500);
  CHECK(!uiCard.on, "and goes after 20 s of quiet");
  uiIdle.have = false; uiIdleOn = false;
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

  // Looking something up: the book and flames show while a look-up runs, and stop when the server says so, when he is spoken to, or after 45 s.
  uiClearCard(); uiIdle.have = false; uiSetMode(UI_THINK); uiMotion = false; uiActivity(now); pause(300);
  uiLookup(now, true);
  long fillsBefore = fillsAbove; pause(1000);
  CHECK(uiLookupOn && fillsBefore >= 0, "the look-up starts");
  uiSetMode(UI_SPEAK); pause(100);
  CHECK(uiLookupOn, "it carries on while he says 'let me check' (speaking doesn't end it)");
  uiSetMode(UI_THINK); pause(500);
  CHECK(uiLookupOn, "and when he goes back to thinking");
  uiLookup(now, false); pause(100);
  CHECK(!uiLookupOn, "it stops when the server says the look-up is over");
  uiLookup(now, true); uiSetMode(UI_LISTEN); pause(100);
  CHECK(!uiLookupOn, "or when he is spoken to again");
  uiSetMode(UI_THINK); uiLookup(now, true); pause(46000);
  CHECK(!uiLookupOn, "and after 45 s whatever happens");
  uiSetMode(UI_READY); uiMotion = true;

  // Recording: the Record tile asks to start; the recording screen shows the time and a Stop; it dims, wakes, and the info screen has a button.
  static int recWhat = 0;
  uiOut.record = [](int a) { recWhat = a; };
  uiOut.brightness = [](int l) { level = l; };
  uiIdle.have = true; uiIdle.after = 10; uiClearCard(); uiSetMode(UI_READY); uiActivity(now); pause(300);
  uiRecAvailable = true;
  uiMenuOpen(now); icon(UI_L_RECORD, &tx, &ty); finger(tx, ty, 60); finger(UI_CX, uiRecCircleY(), 1100);
  CHECK(recWhat == UI_REC_START && !uiCard.on, "Record asks the sketch to start recording");
  uiRecRun(now, 1, 6000, 3); pause(100);
  CHECK(uiRec.state == UI_RECS_RUN, "the recording screen is up");
  pause(12000);
  CHECK(!uiIdleOn && !uiCard.on, "while recording the idle face never comes");
  CHECK(!uiRec.dimmed, "it is not dimmed yet at 12 s");
  uiRecRun(now, 14, 5990, 3);
  pause(9000);
  CHECK(uiRec.dimmed && level == 40, "the screen dims after 20 s without a touch");
  recWhat = 0;
  finger(UI_CX, uiStopY(), 60);
  CHECK(!uiRec.dimmed && level == uiFullLevel() && recWhat == 0, "the touch that wakes the screen only wakes it (it doesn't stop the recording)");
  pause(21000);
  CHECK(uiRec.dimmed && level == 40 && uiWantsRaise(), "(raise) the recording screen dims again and wants a raise");
  recWhat = 0; uiRaise(now);
  CHECK(!uiRec.dimmed && level == uiFullLevel() && uiRec.state == UI_RECS_RUN && recWhat == 0, "a raise brightens the recording screen and the recording carries on");
  finger(UI_CX, uiStopY(), 60);
  CHECK(recWhat == 0, "a quick tap on Stop doesn't stop (a pocket can't end a recording)");
  finger(UI_CX, uiStopY(), 400);
  CHECK(recWhat == 0, "nor does letting go half way");
  finger(UI_CX, uiStopY(), 900);
  CHECK(recWhat == UI_REC_STOP, "holding Stop asks to stop");
  recWhat = 0; finger(UI_CX, UI_CY - 160, 60);
  CHECK(recWhat == 0, "a tap anywhere else does nothing");
  uiRecInfo(now, "Saved on the watch", "42 min", "Sending to your phone...", 60, "");
  pause(100);
  CHECK(uiRec.state == UI_RECS_INFO && uiRec.pct == 60, "the sending screen shows its progress");
  uiRecInfo(now, "Not sent", "", "No Wi-Fi. It will send later.", -1, "OK");
  pause(100); recWhat = 0; finger(UI_CX, uiRecBtnY(), 60);
  CHECK(recWhat == UI_REC_OK, "its button answers OK");
  uiRecInfo(now, "A recording is waiting", "1 minute", "Send it before a new one", -1, "Send now", UI_REC_RETRY);
  pause(100); recWhat = 0; finger(UI_CX, uiRecBtnY(), 60);
  CHECK(recWhat == UI_REC_RETRY, "Send now asks to send (not just close)");
  uiRecInfo(now, "Couldn't send (it's safe)", "", "No answer", -1, "Try again", UI_REC_RETRY);
  pause(100); recWhat = 0; finger(UI_CX, uiRecBtnY(), 60);
  CHECK(recWhat == UI_REC_RETRY, "Try again asks to send again");
  uiRecEnd(); pause(100);
  CHECK(uiRec.state == UI_RECS_OFF && !uiScreenOff, "ending the recorder gives the screen back");
  uiRecAvailable = false; uiIdle.have = false;

  {
    // One press of the big button, reported twice (its pin and the power chip's own note): counted once, so it opens the menu and never
    // reads as a double press (which starts a recording). Owner, 2026-11-28: "pressing the big button still starts recording immediately".
    static int starts = 0;
    uiOut.record = [](int a) { if (a == UI_REC_START) starts++; };
    auto press = [](uint32_t ms, int src) { if (uiPwrAccept(ms, src)) uiPwrPress(ms); };
    uiPwrPinSeen = false; uiPwrLastSrc = -1; uiPwrLastAt = 0; uiPwrFirst = 0;
    uiClearCard(); uiRec.state = UI_RECS_OFF; uiRecAvailable = true; uiDoublePress = 0;
    int before = starts;
    uint32_t t = 900000;
    press(t, UI_PWR_CHIP); press(t + 60, UI_PWR_PIN);                // the chip's note first, then the pin: one press
    uiPwrTick(t + 500);
    CHECK(uiMenuOn() && starts == before, "one big-button press reported twice opens the menu and starts no recording");
    uiClearCard();
    t += 5000;
    press(t, UI_PWR_PIN); press(t + 80, UI_PWR_CHIP);                // the pin first: from now on the pin is the only source
    uiPwrTick(t + 500);
    CHECK(uiMenuOn() && starts == before, "pin first, then the chip's note: still one press");
    uiClearCard();
    t += 5000;
    press(t, UI_PWR_PIN); press(t + 40, UI_PWR_CHIP); press(t + 220, UI_PWR_PIN); press(t + 260, UI_PWR_CHIP);   // two real presses, each reported twice
    CHECK(starts == before + 1, "a real double press still starts a recording (once)");
    uiRecEnd(); uiClearCard();
    // A board whose button reaches only the power chip: its notes are the presses.
    uiPwrPinSeen = false; uiPwrLastSrc = -1; uiPwrFirst = 0; uiDoublePress = 2;
    t += 5000;
    press(t, UI_PWR_CHIP);
    CHECK(uiMenuOn(), "on a board where only the power chip sees the button, its note opens the menu");
    uiClearCard(); uiDoublePress = 0;
  }
  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
