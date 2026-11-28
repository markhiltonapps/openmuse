// neddy_shell.h: the watch's own screens, opened with the PWR button.
//
//   The launcher (a double click of BOOT, or PWR): Neddy in the middle, the battery at the top and seven icons along the bottom
//     arc: weather, watch face, next meeting, record, settings, info, screen off. Tap Neddy or press PWR to close it; hold Neddy
//     to talk, as everywhere.
//   Record: swipe between Voice note, Idea, Meeting and Dream; HOLD the circle about a second (a ring fills) to start: a tap, a
//     pocket or a press of PWR never starts one (owner, 2026-11-28). Asking Neddy by voice starts at once. Each is filed differently
//     in the Neddy app (written down word for word, a sorted list, a write-up, a dream journal entry).
//   Settings: one setting a page, swiped sideways: brightness, volume, dim after, screen off after, colour, battery saver,
//     raise to wake, animation and what a double press of PWR does. Every one can also be changed by asking Neddy.
//   Info: swiped up and down: battery, firmware and recording room; Wi-Fi, memory and the board; a Restart button.
// PWR goes back a step (on the Record pages too: it never starts a recording). Nothing here is left on screen more than 20 s untouched.
//
// Included by neddy_ui.h (after the cards and the touch state it uses); drawn with neddy_draw.h, so it works on both screens.
#pragma once

enum { UI_SET_ANIM = 1, UI_SET_FACE = 2, UI_SET_VOLUME = 3, UI_SET_BRIGHT = 4, UI_SET_DIM = 5, UI_SET_OFF = 6, UI_SET_ACCENT = 7,
       UI_SET_SAVER = 8, UI_SET_RAISE = 9, UI_SET_DOUBLE = 10 };
enum { UI_ACT_RESTART = 1 };
enum { UI_SHL_HOME, UI_SHL_REC, UI_SHL_SET, UI_SHL_INFO };
static int uiShl = UI_SHL_HOME, uiShlPage = 0;

static int uiDoublePress = 0;                    // a double press of PWR: 0 starts a recording (the mode used last), 1 talks hands-free, 2 nothing
static bool uiRecAvailable = false;              // the sketch found the recording storage
static char uiRecSub[28] = "Up to 1 h 40 min";       // how long it can record, or that one is waiting to be sent
struct UiInfo { char fw[16]; char wifi[28]; int rssi; int heapKb; int psramKb; const char *board; };
static UiInfo uiInfo = { "", "", 0, 0, 0, "" };
static bool uiMenuOn() { return uiCard.on && uiCard.kind == UI_CARD_MENU; }
static bool uiShellHome() { return uiMenuOn() && uiShl == UI_SHL_HOME; }

// ---- where the launcher's icons go: the battery at the top, seven icons along the bottom arc (a circle on the round screen, an
// oval on the rectangle), like the reference: weather, watch face, next meeting, record, settings, info, screen off.
enum { UI_L_BATTERY, UI_L_WEATHER, UI_L_FACE, UI_L_MEETING, UI_L_RECORD, UI_L_SETTINGS, UI_L_INFO, UI_L_OFF, UI_L_N };
static const float UI_L_ANGLES[UI_L_N] = { -90, 190, 156.67f, 123.33f, 90, 56.67f, 23.33f, -10 };
static const int UI_L_ICONS[UI_L_N] = { UI_IC_INFO, UI_IC_CLOUDSUN, UI_IC_CLOCK, UI_IC_CALENDAR, UI_IC_MIC, UI_IC_SLIDERS, UI_IC_INFO, UI_IC_SCREENOFF };
static void uiLauncherPos(int i, float *x, float *y) {
  float a = UI_L_ANGLES[i] * 0.0174533f;
#if NEDDY_ROUND
  float rx = UI_W * 0.5f - 53, ry = rx;
#else
  float rx = UI_W * 0.5f - 48, ry = UI_H * 0.5f - 52;
#endif
  *x = UI_CX + rx * cosf(a); *y = UI_CY + ry * sinf(a);
}
#define UI_L_ICON 60
#define UI_L_HIT 50                              // a touch within 50 px of an icon's middle: 100 px across, about 8 to 10 mm
// Neddy in the launcher: smaller and higher than on his own screen, so the arc of icons fits under him.
#define UI_L_NEDDY_FOOT 40
static bool uiOnLauncherNeddy(int x, int y) { return abs(x - UI_CX) < 72 && y > UI_CY - 124 && y < UI_CY + UI_L_NEDDY_FOOT + 16; }

static void uiDrawLauncher() {
  for (int i = 0; i < UI_L_N; i++) {               // each icon painted in its own box: the black round Neddy is never touched
    float x, y; uiLauncherPos(i, &x, &y);
    uiShClear();
    if (i == UI_L_BATTERY && uiIdle.bat >= 0) uiBatteryAdd(x, y - 8, 56, uiIdle.bat, uiIdle.chg, uiAcc());
    else uiIconAdd(UI_L_ICONS[i], x, y, UI_L_ICON, (i == UI_L_RECORD && !uiRecAvailable) ? UI_DIM : uiAcc());
    int h = UI_L_ICON / 2 + 4;
    uiShPaint((int)x - h, (int)y - h, 2 * h, 2 * h);
  }
  if (uiIdle.bat >= 0) {                         // the battery's percent, under its icon
    float x, y; uiLauncherPos(UI_L_BATTERY, &x, &y);
    char t[8]; snprintf(t, sizeof(t), "%d%%", uiIdle.bat > 100 ? 100 : uiIdle.bat);
    uiTrackedCentered(NFONT_MID, (int)x, (int)y + 14, t, UI_LABEL, 1);
  }
}

// ---- the Record pages: one mode each
static int uiRecCircleY() { return UI_CY + 14; }
#define UI_REC_GO_DY 76                          // "HOLD TO START" under the type's name (from the circle's centre)
static uint32_t uiRecHintUntil = 0;              // a tap (or a let-go too soon) lights "HOLD TO START" up until then, so a tap isn't met with nothing
#define UI_REC_RING 154
static void uiDrawRecPage() {
  const int mode = uiShlPage & 3;
  const uint16_t red = UI_REC_RED, dimRed = uiRgb(150, 30, 26);
  if (mode == 3) {
    // Dreams: a glowing ring at the edge, faint star-lines and a few stars round it; the middle stays dark.
    uiShClear();
#if NEDDY_ROUND
    uiShAdd(UI_SH_RING, UI_CX, UI_CY, UI_W * 0.5f - 22, 16, 0, 0, uiRgb(120, 40, 10), 0.55f);
    uiShAdd(UI_SH_RING, UI_CX, UI_CY, UI_W * 0.5f - 22, 5, 0, 0, uiRgb(255, 140, 70));
    for (int i = 0; i < 12; i++) {                // a ring of thin circles round the middle, like a dreamcatcher
      float a = i * 0.5235988f;
      uiShAdd(UI_SH_RING, UI_CX + 168 * cosf(a), uiRecCircleY() + 168 * sinf(a), 58, 1.4f, 0, 0, uiRgb(200, 120, 50), 0.4f);
    }
#else
    uiShAdd(UI_SH_BOXRING, UI_CX, UI_CY, UI_W * 0.5f - 12, UI_H * 0.5f - 12, UI_CORNER, 16, uiRgb(120, 40, 10), 0.55f);
    uiShAdd(UI_SH_BOXRING, UI_CX, UI_CY, UI_W * 0.5f - 18, UI_H * 0.5f - 18, UI_CORNER - 4, 5, uiRgb(255, 140, 70));
    for (int i = 0; i < 12; i++) {
      float a = i * 0.5235988f;
      uiShAdd(UI_SH_RING, UI_CX + 150 * cosf(a), uiRecCircleY() + 190 * sinf(a), 56, 1.4f, 0, 0, uiRgb(200, 120, 50), 0.4f);
    }
#endif
    uiShPaint(0, 0, UI_W, UI_H);
    uint32_t seed = 7;
    for (int i = 0; i < 26; i++) {
      seed = seed * 1103515245u + 12345u; float sx = (seed >> 8) % UI_W;
      seed = seed * 1103515245u + 12345u; float sy = (seed >> 8) % UI_H;
      float dx = sx - UI_CX, dy = sy - uiRecCircleY();
      if (dx * dx + dy * dy < (UI_REC_RING + 8) * (UI_REC_RING + 8) || uiHalfAt((int)sy, 34) < fabsf(sx - UI_CX)) continue;
      uiOut.fill(((int)sx) & ~1, ((int)sy) & ~1, 2, 2, uiRgb(170, 170, 230));
    }
  } else {
    uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
    for (int i = 0; i < 64; i++) uiEdgeDot(i, 64, 24, 2.6f, dimRed);   // each dot in its own small box (quick on the watch)
  }
  // The ring and its contents: one box over the middle; the dots above it separately (the Dream lines stay untouched around).
  uiShClear();
  uiShAdd(UI_SH_RING, UI_CX, uiRecCircleY(), UI_REC_RING, 2.5f, 0, 0, mode == 3 ? uiRgb(255, 140, 70) : red);
  uiShAdd(UI_SH_DISC, UI_CX, uiRecCircleY(), UI_REC_RING - 2, 0, 0, 0, UI_BLACK);
  uiIconAdd(UI_REC_ICONS[mode], UI_CX, uiRecCircleY() - 40, 110, uiRecAvailable ? uiAcc() : UI_DIM);
  // painted only over the circle's square, with the corners left alone: the disc keeps the background inside
  {
    int h = UI_REC_RING + 4, y0 = uiRecCircleY() - h;
    // paint in rows clipped to the circle so the corners (the edge dots and Dream lines) aren't wiped
    for (int y = y0; y < y0 + 2 * h; y += 24) {
      float dy = (y + 12) - uiRecCircleY(), dy2 = fabsf(dy) - 12 < 0 ? 0 : fabsf(dy) - 12;
      float half = h * h > dy2 * dy2 ? sqrtf(h * h - dy2 * dy2) + 4 : 0;
      if (half <= 0) continue;
      uiShPaint((int)(UI_CX - half), y, (int)(2 * half), 24);
    }
  }
  uiShClear();
  uiPageDotsAdd(4, mode, false);
  uiShPaintAll();
  // Inside the ring: "< SWIPE >" over the icon (the other types are a swipe away), the mode's name, and a red dot with "HOLD TO START".
  const int rc = uiRecCircleY();
  uiTrackedCentered(NFONT_MID, UI_CX, rc - 128, uiRecAvailable ? "< SWIPE >" : "UNAVAILABLE", UI_LABEL, 2);
  uiTrackedCentered(NFONT_TITLE, UI_CX, rc + 26, UI_REC_NAMES[mode], UI_WHITE, 3);
  if (uiRecAvailable) {
    const char *go = "HOLD TO START";
    int w = uiTrackedWidth(NFONT_MID, go, 1);
    uiTrackedCentered(NFONT_MID, UI_CX + 12, rc + UI_REC_GO_DY, go, uiRecHintUntil && uiNowMs < uiRecHintUntil ? uiAcc() : UI_LABEL, 1);
    uiShClear(); uiShAdd(UI_SH_DISC, UI_CX + 12 - w / 2 - 16, rc + UI_REC_GO_DY + NFONT_MID.h / 2, 7, 0, 0, 0, red); uiShPaintAll();
  }
}

// ---- Settings: one a page
enum { UI_PG_BRIGHT, UI_PG_VOLUME, UI_PG_DIM, UI_PG_OFF, UI_PG_COLOUR, UI_PG_SAVER, UI_PG_RAISE, UI_PG_ANIM, UI_PG_DOUBLE, UI_PG_N };
static const int UI_DIM_STEPS[6] = { 0, 15, 30, 60, 120, 300 };       // seconds; 0 = never dims
static const int UI_OFF_STEPS[6] = { 0, 60, 120, 300, 600, 1800 };    // seconds; 0 = never goes dark by itself
static int uiDimNow() { return !uiIdle.dim ? 0 : (uiIdle.dimAfter > 0 ? uiIdle.dimAfter : 60); }
static void uiSecondsText(char *out, size_t n, int s, const char *never) {
  if (s <= 0) snprintf(out, n, "%s", never);
  else if (s < 60) snprintf(out, n, "%d s", s);
  else snprintf(out, n, "%d min", s / 60);
}
static int uiStepIndex(const int *steps, int v) { int best = 0; for (int i = 0; i < 6; i++) if (abs(steps[i] - v) < abs(steps[best] - v)) best = i; return best; }

// The slider pages: an arc along the bottom, its middle `UI_ARC_R` below this point.
#define UI_ARC_R 170
static int uiArcCY() { return NEDDY_ROUND ? UI_CY - 36 : UI_CY - 26; }
static int uiSliderValue() { return uiShlPage == UI_PG_BRIGHT ? uiBright : uiVolume; }
static void uiDrawSlider(int v) {
  float f = (v < 0 ? 0 : v > 100 ? 100 : v) / 100.0f, ang = 150.0f - 120.0f * f;
  uiShClear();
  uiShAdd(UI_SH_ARC, UI_CX, uiArcCY(), UI_ARC_R, 12, 30, 150, uiBlend(UI_BLACK, UI_LABEL, 0.25f));
  if (f > 0.005f) uiShAdd(UI_SH_ARC, UI_CX, uiArcCY(), UI_ARC_R, 12, ang, 150, uiAcc());
  float kx = UI_CX + UI_ARC_R * cosf(ang * 0.0174533f), ky = uiArcCY() + UI_ARC_R * sinf(ang * 0.0174533f);
  uiShAdd(UI_SH_DISC, kx, ky, 17, 0, 0, 0, UI_WHITE);
  uiShAdd(UI_SH_RING, kx, ky, 17, 2, 0, 0, uiBlend(UI_WHITE, UI_BLACK, 0.4f));
  int x0 = UI_CX - UI_ARC_R - 24, y0 = uiArcCY() + (int)(UI_ARC_R * 0.5f) - 26;
  uiShPaint(x0, y0, 2 * UI_ARC_R + 48, UI_ARC_R - (int)(UI_ARC_R * 0.5f) + 52);
}
// A value in big digits ("70%"), a number with a smaller unit ("2 min"), or a word ("Amber") in the title size: the big font
// has digits only. Cleared and centred in a box `maxw` wide.
static void uiDrawBigValue(const char *s, int y, uint16_t col, int maxw = 300) {
  const char *digits = "0123456789-.,:%$+ \x7f";
  int split = 0;
  while (s[split] && strchr(digits, s[split])) split++;
  int end = split; while (end > 0 && s[end - 1] == ' ') end--;
  uiFillE(UI_CX - maxw / 2, y, maxw, NFONT_BIG.h + 2, UI_BLACK);
  if (!s[split]) { uiTextCentered(NFONT_BIG, y, s, col); return; }                 // all digits
  if (end == 0) { uiTextCentered(NFONT_TITLE, y + (NFONT_BIG.h - NFONT_TITLE.h) / 2, s, col); return; }   // a word
  char num[16]; int n = end < 15 ? end : 15; memcpy(num, s, n); num[n] = 0;
  const char *unit = s + split;
  int nw = uiTextWidth(NFONT_BIG, num), uw = uiTextWidth(NFONT_TITLE, unit), gap = 10, x = UI_CX - (nw + gap + uw) / 2;
  uiText(NFONT_BIG, x, y, num, col);
  uiText(NFONT_TITLE, x + nw + gap, y + NFONT_BIG.h - NFONT_TITLE.h - 6, unit, col);
}
static int uiPageLabelY() { return NEDDY_ROUND ? UI_CY - 126 : UI_CY - 150; }
static void uiDrawStepper(const char *value, const char *sub) {
  uiShClear();
  for (int s = 0; s < 2; s++) {
    float x = UI_CX + (s ? 150 : -150), y = UI_CY;
    uiShAdd(UI_SH_DISC, x, y, 44, 0, 0, 0, uiBlend(UI_BLACK, uiAcc(), 0.38f));
    uiShAdd(UI_SH_RING, x, y, 44, 4, 0, 0, uiAcc());
    uiShAdd(UI_SH_SEG, x - 17, y, x + 17, y, 3.5f, 0, UI_WHITE);
    if (s) uiShAdd(UI_SH_SEG, x, y - 17, x, y + 17, 3.5f, 0, UI_WHITE);
  }
  uiShPaint(UI_CX - 200, UI_CY - 50, 400, 100);
  uiDrawBigValue(value, UI_CY - NFONT_BIG.h / 2, uiAcc(), 200);
  uiFillE(UI_CX - 150, UI_CY + 60, 300, NFONT_MID.h + 2, UI_BLACK);
  uiTextCentered(NFONT_MID, UI_CY + 62, sub, UI_LABEL);
}
static void uiDrawToggle(bool on, const char *sub) {
  uiShClear();
  float y = UI_CY + 4;
  if (on) {
    uiShAdd(UI_SH_BOX, UI_CX, y, 82, 44, 44, 0, uiAcc());
    uiShAdd(UI_SH_DISC, UI_CX + 40, y, 34, 0, 0, 0, UI_WHITE);
  } else {
    uiShAdd(UI_SH_BOX, UI_CX, y, 82, 44, 44, 0, uiBlend(UI_BLACK, UI_LABEL, 0.22f));
    uiShAdd(UI_SH_BOXRING, UI_CX, y, 82, 44, 44, 2, uiBlend(UI_BLACK, UI_LABEL, 0.45f));
    uiShAdd(UI_SH_DISC, UI_CX - 40, y, 34, 0, 0, 0, UI_LABEL);
  }
  uiShPaint(UI_CX - 90, (int)y - 50, 180, 100);
  uiFillE(UI_CX - 190, UI_CY + 62, 380, NFONT_MID.h * 2 + 8, UI_BLACK);
  uiTextCentered(NFONT_MID, UI_CY + 62, on ? "On" : "Off", UI_WHITE);   // the state in words first
  if (sub && sub[0]) { char fit[48]; uiFit(fit, sizeof(fit), NFONT_MID, sub, 2 * uiHalfAt(UI_CY + 110, 30)); uiTextCentered(NFONT_MID, UI_CY + 94, fit, UI_LABEL); }
}
// Three (or four) round choices in a row, the chosen one filled; the chosen name big above them.
static void uiDrawChoices(int n, int chosen, const int *icons, const uint16_t *cols, const char *name, uint16_t nameCol) {
  uiDrawBigValue(name, UI_CY - 70, nameCol);
  uiShClear();
  float gap = n == 4 ? 96 : 120, y = UI_CY + 66;
  for (int i = 0; i < n; i++) {
    float x = UI_CX + (i - (n - 1) * 0.5f) * gap;
    if (cols) {
      uiShAdd(UI_SH_DISC, x, y, 32, 0, 0, 0, cols[i]);
      if (i == chosen) uiShAdd(UI_SH_RING, x, y, 42, 4, 0, 0, UI_WHITE);
    } else {
      if (i == chosen) uiShAdd(UI_SH_DISC, x, y, 44, 0, 0, 0, uiBlend(UI_BLACK, uiAcc(), 0.38f));
      uiShAdd(UI_SH_RING, x, y, 44, i == chosen ? 4 : 2.5f, 0, 0, i == chosen ? UI_WHITE : uiBlend(UI_BLACK, UI_LABEL, 0.5f));
      uiIconAdd(icons[i], x, y, 54, i == chosen ? uiAcc() : UI_LABEL);
    }
  }
  uiShPaint(UI_CX - 200, (int)y - 52, 400, 104);
}
static const char *const UI_PG_TITLES[UI_PG_N] = { "BRIGHTNESS", "VOLUME", "DIM AFTER", "SCREEN OFF AFTER", "COLOR", "BATTERY SAVER", "RAISE TO WAKE", "ANIMATION", "DOUBLE PRESS" };
static void uiDrawSettingValue() {
  char t[24];
  switch (uiShlPage) {
    case UI_PG_BRIGHT: case UI_PG_VOLUME: {
      int v = uiSliderValue();
      if (uiShlPage == UI_PG_VOLUME && v <= 0) snprintf(t, sizeof(t), "Muted"); else snprintf(t, sizeof(t), "%d%%", v);
      uiDrawBigValue(t, UI_CY - 70, uiAcc());
      uiDrawSlider(v);
      break;
    }
    case UI_PG_DIM: uiSecondsText(t, sizeof(t), uiDimNow(), "Never"); uiDrawStepper(t, uiDimNow() ? (uiSaver ? "then dims to 4%" : "then dims to 15%") : "stays bright"); break;
    case UI_PG_OFF: uiSecondsText(t, sizeof(t), uiIdle.offAfter, "Never"); uiDrawStepper(t, uiIdle.offAfter ? "then the screen goes dark" : (uiSaver ? "dark 45 s after dimming" : "stays on")); break;
    case UI_PG_COLOUR: uiDrawChoices(4, uiAccentIdx, nullptr, UI_ACCENTS, UI_ACCENT_NAMES[uiAccentIdx & 3], uiAcc()); break;
    case UI_PG_SAVER: uiDrawToggle(uiSaver, uiSaver ? "Wi-Fi rests between messages" : "faster answers"); break;
    case UI_PG_RAISE: uiDrawToggle(uiIdle.raise, uiIdle.raise ? "lift your wrist to brighten" : ""); break;
    case UI_PG_ANIM: {
      static const int icons[3] = { UI_IC_BARS1, UI_IC_BARS2, UI_IC_BARS3 };
      uiDrawChoices(3, uiFpsLevel, icons, nullptr, uiFpsLevel == 0 ? "Saver" : uiFpsLevel == 2 ? "Smooth" : "Normal", uiAcc());
      break;
    }
    case UI_PG_DOUBLE: {
      static const int icons[3] = { UI_IC_MIC, UI_IC_CHAT, UI_IC_NONE };
      uiDrawChoices(3, uiDoublePress, icons, nullptr, uiDoublePress == 0 ? "Record" : uiDoublePress == 1 ? "Talk" : "Nothing", uiAcc());
      // With a double-press action, a single press waits a moment to see whether a second comes: say so.
      uiFillE(UI_CX - 200, UI_CY + 120, 400, 2 * NFONT_MID.h + 4, UI_BLACK);
      if (uiDoublePress != 2) { uiTextCentered(NFONT_MID, UI_CY + 120, NEDDY_ROUND ? "The big button opens the menu" : "PWR opens the menu", UI_LABEL); uiTextCentered(NFONT_MID, UI_CY + 120 + NFONT_MID.h, "a moment later", UI_LABEL); }
      break;
    }
  }
}
static void uiDrawSettings() {
  uiTopTitle("SETTINGS", UI_LABEL);
  uiShClear(); uiPageDotsAdd(UI_PG_N, uiShlPage, false); uiShPaintAll();
  uiTrackedCentered(NFONT_MID, UI_CX, uiPageLabelY(), UI_PG_TITLES[uiShlPage], UI_WHITE, 5);
  uiDrawSettingValue();
}

// ---- Info: three pages, up and down
// The Restart button; `f` (0..1) is how far a hold has got: it fills from the left, and a full second restarts the watch.
static void uiDrawRestart(float f) {
  // Held, the whole button glows from dark to full red (one colour at a time, so the word sits on a plain background).
  const uint16_t fill = uiBlend(uiRgb(90, 16, 12), UI_REC_RED, f < 0 ? 0 : f > 1 ? 1 : f);
  uiShClear();
  uiShAdd(UI_SH_BOX, UI_CX, UI_CY + 10, 150, 46, 46, 0, fill);
  uiShAdd(UI_SH_BOXRING, UI_CX, UI_CY + 10, 150, 46, 46, 3, UI_REC_RED);
  uiShPaint(UI_CX - 154, UI_CY - 40, 308, 100);
  uiTrackedCentered(NFONT_MID, UI_CX, UI_CY + 10 - NFONT_MID.h / 2, "RESTART", UI_WHITE, 4, fill);
}
#define UI_INFO_N 3
static void uiInfoRow(int y, const char *label, const char *value) {
  uiTrackedCentered(NFONT_MID, UI_CX, y, label, UI_LABEL, 4);
  char fit[32]; uiFit(fit, sizeof(fit), NFONT_TITLE, value, 2 * uiHalfAt(y + 60, 36));
  uiTextCentered(NFONT_TITLE, y + 30, fit, uiAcc());
}
static int uiInfoTop() { return NEDDY_ROUND ? UI_CY - 132 : UI_CY - 136; }
static void uiDrawInfo() {
  uiTopTitle("NEDDY", UI_LABEL);
  uiShClear(); uiPageDotsAdd(UI_INFO_N, uiShlPage, true); uiShPaintAll();
  static const char *const heads[UI_INFO_N] = { "INFO", "SYSTEM", "ACTIONS" };
  int y = uiInfoTop();
  uiTrackedCentered(NFONT_MID, UI_CX, y, heads[uiShlPage], UI_LABEL, 5);
  char a[32], b[32], c[32];
  if (uiShlPage == 0) {
    if (uiIdle.bat < 0) snprintf(a, sizeof(a), uiIdle.vbus ? "Plugged in" : "Unknown");
    else snprintf(a, sizeof(a), uiIdle.chg ? "%d%% charging" : "%d%%", uiIdle.bat > 100 ? 100 : uiIdle.bat);
    snprintf(b, sizeof(b), "%s", uiInfo.fw[0] ? uiInfo.fw : "-");
    snprintf(c, sizeof(c), "%s", !uiRecAvailable ? "Not available" : strncmp(uiRecSub, "Up to ", 6) == 0 ? uiRecSub + 6 : uiRecSub);   // "1 h 40 min" under RECORDING
    uiInfoRow(y + 54, "BATTERY", a); uiInfoRow(y + 140, "FIRMWARE", b); uiInfoRow(y + 226, "RECORDING", c);
  } else if (uiShlPage == 1) {
    if (uiInfo.wifi[0]) snprintf(a, sizeof(a), "%s", uiInfo.wifi); else snprintf(a, sizeof(a), "Off");
    snprintf(b, sizeof(b), "%d KB free", uiInfo.heapKb);
    snprintf(c, sizeof(c), "%s", uiInfo.board && uiInfo.board[0] ? uiInfo.board : "-");
    uiInfoRow(y + 54, "WI-FI", a); uiInfoRow(y + 140, "MEMORY", b); uiInfoRow(y + 226, "BOARD", c);
  } else {
    uiDrawRestart(0);
    uiTextCentered(NFONT_MID, UI_CY + 84, "Hold to restart the watch", UI_LABEL);
  }
}

static void uiShellDraw() {
  if (uiShl == UI_SHL_HOME) uiDrawLauncher();
  else if (uiShl == UI_SHL_REC) uiDrawRecPage();
  else if (uiShl == UI_SHL_SET) uiDrawSettings();
  else uiDrawInfo();
}

// ---- opening, going back, and the PWR button
static void uiShellGo(int where, int page) { uiShl = where; uiShlPage = page; uiCard.since = uiNowMs; uiAll = true; }
static void uiMenuOpen(uint32_t ms) {
  if (uiMenuOn()) { uiClearCard(); return; }        // (the button again closes it)
  uiShl = UI_SHL_HOME; uiShlPage = 0;
  uiStartCard(ms, UI_CARD_MENU);
}
static void uiStartRecording(int mode) {
  if (!uiRecAvailable) return;
  uiRecMode = mode & 3;
  uiClearCard();
  if (uiOut.record) uiOut.record(UI_REC_START);
}
static void uiShellPwr(uint32_t ms) {
  if (uiShl == UI_SHL_HOME) uiClearCard();
  else uiShellGo(UI_SHL_HOME, 0);                  // (on the Record pages too: a side button pressed in a pocket never starts a recording)
  (void)ms;
}
// PWR: a single press opens the launcher (or goes back, or starts the recording); with a double-press action set, the single press
// waits 400 ms to see whether a second one comes. On the inner pages the press acts at once.
#define UI_PWR_DOUBLE_MS 400
static uint32_t uiPwrFirst = 0;
static void uiPwrSingle(uint32_t ms) { if (uiMenuOn()) uiShellPwr(ms); else uiMenuOpen(ms); }
static void uiPwrDouble(uint32_t ms) {
  uiActivity(ms);
  if (uiDoublePress == 0) { if (uiRecAvailable) uiStartRecording(uiRecMode); else uiMenuOpen(ms); }
  else if (uiDoublePress == 1) { uiClearCard(); uiTchLatched = true; uiTouchTalk = true; }
}
static void uiPwrPress(uint32_t ms) {
  if (uiDoublePress == 2 || (uiMenuOn() && uiShl != UI_SHL_HOME)) { uiPwrFirst = 0; uiPwrSingle(ms); return; }
  if (uiPwrFirst && ms - uiPwrFirst < UI_PWR_DOUBLE_MS) { uiPwrFirst = 0; uiPwrDouble(ms); return; }
  uiPwrFirst = ms ? ms : 1;
}
static void uiPwrTick(uint32_t ms) { if (uiPwrFirst && ms - uiPwrFirst >= UI_PWR_DOUBLE_MS) { uiPwrFirst = 0; uiPwrSingle(ms); } }
// One press, two reports: on the round watch the big button reaches its own pin AND the power chip, which keeps its own note of each
// press, so a single press arrived twice and counted as a double press (it started a recording; owner, 2026-11-28). Once the pin has
// reported a press it is the only source; a power-chip report within 600 ms of a pin report, either way round, is the same press.
enum { UI_PWR_PIN = 0, UI_PWR_CHIP = 1 };
static bool uiPwrPinSeen = false;
static uint32_t uiPwrLastAt = 0;
static int uiPwrLastSrc = -1;
static bool uiPwrAccept(uint32_t ms, int src) {
  if (src == UI_PWR_CHIP && uiPwrPinSeen) return false;
  bool twin = uiPwrLastSrc >= 0 && uiPwrLastSrc != src && ms - uiPwrLastAt < 600;
  if (src == UI_PWR_PIN) uiPwrPinSeen = true;
  uiPwrLastAt = ms; uiPwrLastSrc = src;
  return !twin;
}

// ---- BOOT: hold to talk, starting after a quarter second so a tap never starts a talk; a double click opens the launcher
// (as on the reference watch; owner, 2026-11-27). PWR opens it too.
#define UI_BOOT_HOLD_MS 250
#define UI_BOOT_DOUBLE_MS 400
static bool uiBootDown = false, uiBootTalking = false;
static uint32_t uiBootDownAt = 0, uiBootTapAt = 0;
// Called every turn with the button's state; returns whether BOOT wants the microphone now.
static bool uiBoot(uint32_t ms, bool down) {
  if (down && !uiBootDown) { uiBootDownAt = ms; uiActivity(ms); }
  if (down && !uiBootTalking && ms - uiBootDownAt >= UI_BOOT_HOLD_MS) { uiBootTalking = true; uiBootTapAt = 0; }
  if (!down && uiBootDown) {
    if (uiBootTalking) uiBootTalking = false;
    else if (uiBootTapAt && ms - uiBootTapAt < UI_BOOT_DOUBLE_MS) { uiBootTapAt = 0; if (uiRec.state == UI_RECS_OFF) uiMenuOpen(ms); }
    else uiBootTapAt = ms ? ms : 1;
  }
  uiBootDown = down;
  return uiBootTalking;
}
static void uiBootTick(uint32_t ms) { if (uiBootTapAt && ms - uiBootTapAt >= UI_BOOT_DOUBLE_MS) uiBootTapAt = 0; }

// ---- changing a setting on the watch: kept here, applied, and passed to the sketch (which tells the server)
static void uiSetting(int which, int value) { if (uiOut.setting) uiOut.setting(which, value); }
static void uiSettingChanged(int page, int value) {
  switch (page) {
    case UI_PG_BRIGHT: uiBright = value; if (uiOut.brightness) uiOut.brightness(uiFullLevel()); break;
    case UI_PG_VOLUME: uiVolume = value; break;
    default: break;
  }
}
static void uiSliderSet(int x, int y, bool commit) {
  float dx = x - UI_CX, dy = y - uiArcCY();
  float ang = atan2f(dy, dx) * 57.29578f;
  if (ang < 0) ang = dy < 0 && dx < 0 ? 180 : (dy < 0 ? 0 : ang + 360);   // above the arc's ends: hold at the nearer end
  float f = (150.0f - ang) / 120.0f;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  int v = (int)(f * 100 + 0.5f);
  if (uiShlPage == UI_PG_BRIGHT && v < 10) v = 10;
  if (uiShlPage == UI_PG_VOLUME) v = (v + 2) / 5 * 5;                      // volume in steps of 5
  if (v != uiSliderValue() || commit) {
    uiSettingChanged(uiShlPage, v);
    char t[12];
    if (uiShlPage == UI_PG_VOLUME && v <= 0) snprintf(t, sizeof(t), "Muted"); else snprintf(t, sizeof(t), "%d%%", v);
    uiDrawBigValue(t, UI_CY - 70, uiAcc());
    uiDrawSlider(v);
  }
  if (commit) uiSetting(uiShlPage == UI_PG_BRIGHT ? UI_SET_BRIGHT : UI_SET_VOLUME, v);
}
static bool uiOnSlider(int x, int y) {
  if (uiShl != UI_SHL_SET || (uiShlPage != UI_PG_BRIGHT && uiShlPage != UI_PG_VOLUME)) return false;
  // Only a finger that starts on the knob drags it: a sideways swipe across the arc still turns the page.
  float f = (uiSliderValue() < 0 ? 0 : uiSliderValue() > 100 ? 100 : uiSliderValue()) / 100.0f, ang = (150.0f - 120.0f * f) * 0.0174533f;
  float kx = UI_CX + UI_ARC_R * cosf(ang), ky = uiArcCY() + UI_ARC_R * sinf(ang);
  return (x - kx) * (x - kx) + (y - ky) * (y - ky) <= 56 * 56;
}
static bool uiNear(int x, int y, float cx, float cy, float r) { return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r; }
static void uiSettingsTap(int x, int y) {
  int p = uiShlPage;
  if (p == UI_PG_DIM || p == UI_PG_OFF) {
    int dir = uiNear(x, y, UI_CX - 150, UI_CY, 62) ? -1 : uiNear(x, y, UI_CX + 150, UI_CY, 62) ? 1 : 0;
    if (!dir) return;
    const int *steps = p == UI_PG_DIM ? UI_DIM_STEPS : UI_OFF_STEPS;
    int i = uiStepIndex(steps, p == UI_PG_DIM ? uiDimNow() : uiIdle.offAfter) + dir;
    i = i < 0 ? 0 : i > 5 ? 5 : i;
    if (p == UI_PG_DIM) { uiIdle.dim = steps[i] > 0; uiIdle.dimAfter = steps[i]; uiSetting(UI_SET_DIM, steps[i]); }
    else { uiIdle.offAfter = steps[i]; uiSetting(UI_SET_OFF, steps[i]); }
    uiDrawSettingValue();
  } else if (p == UI_PG_SAVER || p == UI_PG_RAISE) {
    if (fabsf((float)(y - (UI_CY + 10))) > 120) return;
    if (p == UI_PG_SAVER) { uiSaver = !uiSaver; uiSetting(UI_SET_SAVER, uiSaver ? 1 : 0); }
    else { uiIdle.raise = !uiIdle.raise; uiSetting(UI_SET_RAISE, uiIdle.raise ? 1 : 0); }
    uiDrawSettingValue();
  } else if (p == UI_PG_COLOUR || p == UI_PG_ANIM || p == UI_PG_DOUBLE) {
    int n = p == UI_PG_COLOUR ? 4 : 3; float gap = n == 4 ? 96 : 120;
    if (fabsf((float)(y - (UI_CY + 66))) > 62) return;
    int i = (int)floorf((x - UI_CX) / gap + n * 0.5f);
    if (i < 0 || i >= n) return;
    if (p == UI_PG_COLOUR) { uiAccentIdx = i; uiSetting(UI_SET_ACCENT, i); uiAll = true; return; }   // the whole screen takes the new colour
    if (p == UI_PG_ANIM) { uiFpsLevel = i; uiSetting(UI_SET_ANIM, i); }
    else { uiDoublePress = i; uiSetting(UI_SET_DOUBLE, i); }
    uiDrawSettingValue();
  }
}
// Screen off from the launcher: "Screen off / Tap to wake" for a second first, so a dark screen isn't taken for a watch that is off.
static uint32_t uiOffNoticeAt = 0;
static void uiOffNoticeTick(uint32_t ms) {
  if (!uiOffNoticeAt || (int32_t)(ms - uiOffNoticeAt) < 0) return;
  uiOffNoticeAt = 0;
  uiScreenOff = true; uiScreenOffAuto = false;      // dark until a touch, a press or words (a raise of the wrist doesn't wake it)
  if (uiOut.brightness) uiOut.brightness(0);
}
static void uiScreenOffSoon(uint32_t ms) {
  uiClearCard();
  uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
  uiTextCentered(NFONT_TITLE, UI_CY - 50, "Screen off", UI_WHITE);
  uiTextCentered(NFONT_MID, UI_CY + 8, "Tap to wake", UI_LABEL);
  uiOffNoticeAt = ms + 1000;
}
// A short card that names something for a moment (the new watch face), then the face itself.
static int64_t uiUtcNow(uint32_t ms);
static void uiCivil(int64_t local, int *year, int *month, int *day, int *hour, int *minute, int *weekday);
static void uiClockText(char *time, char *ampm, int hour, int minute);
static void uiShowFaceNow(uint32_t ms) {
  if (uiIdle.have && uiIdle.after > 0 && uiMode == UI_READY) { uiIdleOn = true; uiIdleSince = ms; uiDimmed = false; uiIdleMinute = -1; uiWords[0] = 0; uiHeard[0] = 0; }
  uiAll = true;
}
// The next meeting, from the face's own facts (the calendar's next one, read by the server every few minutes).
static void uiShowNextMeeting(uint32_t ms) {
  if (!uiIdle.haveM) {
    if (uiIdle.mc) uiShowFact(ms, "Next meeting", "None", "No more meetings today", "", 0);
    else uiShowFact(ms, "Next meeting", "Ask me", "Hold me and ask about your day", "", 0);
    return;
  }
  int Y, M, D, h, m, wd;
  uiCivil((int64_t)uiIdle.ms + (int64_t)uiIdle.off * 60, &Y, &M, &D, &h, &m, &wd);
  char hh[8], ap[4], when[24], value[16];
  uiClockText(hh, ap, h, m);
  snprintf(value, sizeof(value), "%s %s", hh, ap);
  int64_t until = (int64_t)uiIdle.ms - uiUtcNow(ms);
  if (until <= 0) snprintf(when, sizeof(when), "now");
  else if (until < 3600) snprintf(when, sizeof(when), "in %d min", (int)((until + 59) / 60));
  else if (until < 86400) snprintf(when, sizeof(when), "in %d h %d min", (int)(until / 3600), (int)((until % 3600) / 60));
  else snprintf(when, sizeof(when), "tomorrow");
  uiShowFact(ms, "Next meeting", value, uiIdle.mt, when, 0);
}
static void uiLauncherTap(uint32_t ms, int x, int y) {
  int best = -1; float bestD = (float)UI_L_HIT * UI_L_HIT;     // the nearest icon within reach (their reaches touch)
  for (int i = 0; i < UI_L_N; i++) {
    float ix, iy; uiLauncherPos(i, &ix, &iy);
    float d = (x - ix) * (x - ix) + (y - iy) * (y - iy);
    if (d <= bestD) { bestD = d; best = i; }
  }
  if (best >= 0) {
    switch (best) {
      case UI_L_BATTERY: case UI_L_INFO: uiShellGo(UI_SHL_INFO, 0); return;
      case UI_L_SETTINGS: uiShellGo(UI_SHL_SET, 0); return;
      case UI_L_RECORD: uiShellGo(UI_SHL_REC, uiRecMode); return;
      case UI_L_OFF: uiScreenOffSoon(ms); return;
      case UI_L_FACE: {
        uiFace = (uiFace + 1) % 3;
        uiSetting(UI_SET_FACE, uiFace);
        static const char *const names[3] = { "Info", "Analog", "Neon" };
        uiStartCard(ms, UI_CARD_FACT);                   // its name for a moment, then the face itself
        uiCopyTrim(uiCard.place, sizeof(uiCard.place), "Watch face");
        uiCopyTrim(uiCard.sky, sizeof(uiCard.sky), names[uiFace]);
        uiCard.until = 1200; uiCard.thenFace = true;
        return;
      }
      case UI_L_MEETING: uiShowNextMeeting(ms); return;
      case UI_L_WEATHER:
        if (uiIdle.haveW) uiShowWeather(ms, "Today", uiIdle.wt, UI_NONE, uiIdle.ws, uiIdle.wi, uiIdle.wh, uiIdle.wl, 0, "");
        else uiShowFact(ms, "Weather", "Ask me", "Hold me and ask about the weather", "", 0);
        return;
    }
  }
  if (uiOnLauncherNeddy(x, y)) uiClearCard();      // tap Neddy: close
}

// Holding the Record circle: a white ring fills round it for a second, then the recording starts. Painted in thin bands along the
// ring only (each painted box is cleared first), so the icon and words inside are left alone. Let go early, or move: nothing starts.
#define UI_REC_START_HOLD_MS 1000
static void uiDrawRecHold(float f) {
  if (f <= 0) { uiAll = true; return; }                           // back to the page as it was (the full redraw puts back the ring)
  const float cy = uiRecCircleY(), R = UI_REC_RING, ro = R + 7, ri = R - 7;
  uiShClear();
  uiShAdd(UI_SH_RING, UI_CX, cy, R, 2.5f, 0, 0, uiShlPage == 3 ? uiRgb(255, 140, 70) : UI_REC_RED);
  uiShAdd(UI_SH_ARC, UI_CX, cy, R, 7, -90, -90 + 360 * (f > 1 ? 1 : f), UI_WHITE);
  {                                                               // the red dot before HOLD TO START sits near the ring: keep it whole
    int w = uiTrackedWidth(NFONT_MID, "HOLD TO START", 1);
    uiShAdd(UI_SH_DISC, UI_CX + 12 - w / 2 - 16, cy + UI_REC_GO_DY + NFONT_MID.h / 2, 7, 0, 0, 0, UI_REC_RED);
  }
  for (int y = (int)(cy - ro) & ~1; y < cy + ro; y += 8) {
    float d0 = fabsf(y - cy), d1 = fabsf(y + 8 - cy), near = (y <= cy && y + 8 >= cy) ? 0 : (d0 < d1 ? d0 : d1), far = d0 > d1 ? d0 : d1;
    if (near >= ro) continue;
    float xo = sqrtf(ro * ro - near * near) + 2, xi = far < ri ? sqrtf(ri * ri - far * far) - 2 : 0;
    if (xi > 2) { uiShPaint((int)(UI_CX - xo), y, (int)(xo - xi) + 2, 8); uiShPaint((int)(UI_CX + xi) - 2, y, (int)(xo - xi) + 4, 8); }
    else uiShPaint((int)(UI_CX - xo), y, (int)(2 * xo), 8);
  }
}

// The finger on the launcher and its pages. Swipes turn pages (sideways for Record and Settings, up and down for Info); a finger
// that starts on a slider moves it instead; a hold on Neddy in the launcher talks, as on his own screen.
static struct { bool was, drag, hold, ignore, restart, recHold; int x0, y0, x, y, step; uint32_t at; } uiSt;
#define UI_RESTART_HOLD_MS 1000
static bool uiOnRestart(int x, int y) { return uiShl == UI_SHL_INFO && uiShlPage == 2 && abs(x - UI_CX) < 160 && abs(y - (UI_CY + 10)) < 60; }
static void uiShellTouch(uint32_t ms, bool down, int x, int y) {
  if (uiRecHintUntil && ms >= uiRecHintUntil) { uiRecHintUntil = 0; if (uiShl == UI_SHL_REC) uiAll = true; }   // the lit "HOLD TO START" goes back
  if (down) { uiCard.since = ms; uiActivity(ms); }
  if (down && !uiSt.was) {
    uiSt.x0 = uiSt.x = x; uiSt.y0 = uiSt.y = y; uiSt.at = ms; uiSt.hold = false; uiSt.ignore = false;
    uiSt.drag = uiOnSlider(x, y);
    uiSt.restart = uiOnRestart(x, y); uiSt.step = 0;
    uiSt.recHold = uiShl == UI_SHL_REC && uiRecAvailable && uiNear(x, y, UI_CX, uiRecCircleY(), UI_REC_RING);
    if (uiSt.drag) uiSliderSet(x, y, false);
    if (uiTchLatched) { uiTchLatched = false; uiTouchTalk = false; uiSt.ignore = true; }   // any touch ends hands-free talking
  } else if (down) {
    uiSt.x = x; uiSt.y = y;
    if (uiSt.drag) uiSliderSet(x, y, false);
    else if (uiSt.restart) {                                        // hold Restart: the button fills; a full second restarts
      if (abs(x - uiSt.x0) > UI_SLOP || abs(y - uiSt.y0) > UI_SLOP) { uiSt.restart = false; uiDrawRestart(0); }
      else {
        int step = (int)((ms - uiSt.at) * 10 / UI_RESTART_HOLD_MS);
        if (step != uiSt.step) { uiSt.step = step; uiDrawRestart(step >= 10 ? 1.0f : step / 10.0f); }
        if (ms - uiSt.at >= UI_RESTART_HOLD_MS) { uiSt.restart = false; uiSt.ignore = true; if (uiOut.action) uiOut.action(UI_ACT_RESTART); }
      }
    } else if (uiSt.recHold) {                                      // hold the Record circle: the ring fills; a full second starts it
      if (abs(x - uiSt.x0) > UI_SLOP || abs(y - uiSt.y0) > UI_SLOP) { uiSt.recHold = false; if (uiSt.step) uiDrawRecHold(0); }   // a swipe
      else {
        int step = (int)((ms - uiSt.at) * 10 / UI_REC_START_HOLD_MS);
        if (step != uiSt.step) { uiSt.step = step; uiDrawRecHold(step >= 10 ? 1.0f : step / 10.0f); }
        if (ms - uiSt.at >= UI_REC_START_HOLD_MS) { uiSt.recHold = false; uiSt.ignore = true; uiStartRecording(uiShlPage); }
      }
    } else if (uiShl == UI_SHL_HOME && !uiSt.hold && !uiSt.ignore && uiOnLauncherNeddy(uiSt.x0, uiSt.y0) &&
             abs(x - uiSt.x0) < UI_SLOP && abs(y - uiSt.y0) < UI_SLOP && ms - uiSt.at >= UI_HOLD_MS) {
      uiSt.hold = true; uiClearCard(); uiTouchTalk = true;         // hold Neddy: talk (the launcher gets out of the way)
    }
  } else if (uiSt.was) {
    if (uiSt.drag) uiSliderSet(uiSt.x, uiSt.y, true);
    else if (uiSt.hold) uiTouchTalk = false;
    else if (uiSt.restart) { uiSt.restart = false; uiDrawRestart(0); }   // let go too soon: nothing happens
    else if (uiSt.recHold) { uiSt.recHold = false; uiRecHintUntil = ms + 700; uiAll = true; }   // let go too soon (or a tap): nothing starts; "HOLD TO START" lights up
    else if (!uiSt.ignore) {
      int dx = uiSt.x - uiSt.x0, dy = uiSt.y - uiSt.y0, adx = abs(dx), ady = abs(dy);
      if (adx >= UI_SWIPE && adx * 2 > ady * 3 && (uiShl == UI_SHL_REC || uiShl == UI_SHL_SET)) {
        int n = uiShl == UI_SHL_REC ? 4 : UI_PG_N, p = uiShlPage + (dx < 0 ? 1 : -1);
        if (p >= 0 && p < n) uiShellGo(uiShl, p);
      } else if (ady >= UI_SWIPE && ady * 2 > adx * 3 && uiShl == UI_SHL_INFO) {
        int p = uiShlPage + (dy < 0 ? 1 : -1);
        if (p >= 0 && p < UI_INFO_N) uiShellGo(uiShl, p);
      } else if (adx < UI_SLOP && ady < UI_SLOP && ms - uiSt.at < UI_TAP_MS) {
        if (uiShl == UI_SHL_HOME) uiLauncherTap(ms, uiSt.x0, uiSt.y0);
        else if (uiShl == UI_SHL_SET) uiSettingsTap(uiSt.x0, uiSt.y0);
      }
    }
  }
  uiSt.was = down;
}
