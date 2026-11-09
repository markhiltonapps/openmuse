// neddy_ui.h: Neddy's screen. The whole robot (it can move all the time), glowing eyes that change with
// what's happening, smooth text, and a layout where he shrinks when words appear.
//
// Portable on purpose: the watch (neddy_device.ino) and a test on a computer (firmware/tools/ui_sim.cpp)
// build this same file, so the drawing can be checked on a PC before it ever runs on the board.
#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include "neddy_art.h"
#include "neddy_font.h"

#define UI_W 410
#define UI_H 502

// Where pixels go (set by the sketch, or by the PC test).
struct UiOut {
  void (*blit)(int x, int y, int w, int h, uint16_t *px);
  void (*fill)(int x, int y, int w, int h, uint16_t colour);
};
static UiOut uiOut;

static constexpr uint16_t uiRgb(int r, int g, int b) { return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)); }
static constexpr uint16_t UI_BLACK = 0;
static constexpr uint16_t UI_TEAL = uiRgb(96, 214, 200);
static constexpr uint16_t UI_CORAL = uiRgb(255, 112, 102);
static constexpr uint16_t UI_AMBER = uiRgb(255, 198, 84);
static constexpr uint16_t UI_CYAN = uiRgb(120, 222, 255);
static constexpr uint16_t UI_GREY = uiRgb(122, 128, 134);
static constexpr uint16_t UI_DIM = uiRgb(98, 104, 110);
static constexpr uint16_t UI_WHITE = uiRgb(240, 240, 244);

// ------------------------------------------------------------------ smooth text
static uint16_t uiLine[UI_W * 33];  // one line of text, built here and sent to the screen in one go
static uint16_t uiBg = 0;           // what's behind the text (black, or a card's colour): letters blend into it

static int uiTextWidth(const NeddyFont &f, const char *s) {
  int w = 0;
  for (; *s; s++) {
    int c = (uint8_t)*s;
    if (c < 32 || c > 127) c = '?';
    w += f.adv[c - 32];
  }
  return w;
}

// The AMOLED chip wants every window to start on an even column and row and be an even size; an odd one
// shifts the rows and the text looks sheared. So everything drawn here is lined up on even numbers.
static void uiText(const NeddyFont &f, int x, int y, const char *s, uint16_t fg) {
  int w = uiTextWidth(f, s);
  if (w <= 0) return;
  x &= ~1; y &= ~1;
  if (x < 0) x = 0;
  w = (w + 1) & ~1;
  if (x + w > UI_W) w = (UI_W - x) & ~1;
  if (w <= 0) return;
  int h = f.h, hEven = (h + 1) & ~1;
  int chunk = ((int)(sizeof(uiLine) / sizeof(uiLine[0])) / w) & ~1;   // rows that fit the buffer (a tall font is sent in strips)
  if (chunk > hEven) chunk = hEven;
  if (chunk < 2) chunk = 2;
  int fr = (fg >> 11) & 31, fgc = (fg >> 5) & 63, fb = fg & 31;
  int br = (uiBg >> 11) & 31, bgc = (uiBg >> 5) & 63, bb = uiBg & 31;
  for (int r0 = 0; r0 < hEven; r0 += chunk) {
    int rows = hEven - r0 < chunk ? hEven - r0 : chunk;
    if (uiBg == 0) memset(uiLine, 0, (size_t)w * rows * 2);
    else for (int i = 0; i < w * rows; i++) uiLine[i] = uiBg;
    int cx = 0;
    for (const char *p = s; *p && cx < w; p++) {
      int c = (uint8_t)*p;
      if (c < 32 || c > 127) c = '?';
      int a = f.adv[c - 32];
      const uint8_t *g = f.bits + f.off[c - 32];
      for (int row = r0; row < r0 + rows && row < h; row++) {
        for (int col = 0; col < a && cx + col < w; col++) {
          int al = g[row * a + col];
          if (!al) continue;
          int r = br + ((fr - br) * al + (fr >= br ? 127 : -127)) / 255;
          int gg = bgc + ((fgc - bgc) * al + (fgc >= bgc ? 127 : -127)) / 255;
          int b = bb + ((fb - bb) * al + (fb >= bb ? 127 : -127)) / 255;
          uiLine[(row - r0) * w + cx + col] = (uint16_t)((r << 11) | (gg << 5) | b);
        }
      }
      cx += a;
    }
    uiOut.blit(x, y + r0, w, rows, uiLine);
  }
}

static void uiTextCentered(const NeddyFont &f, int y, const char *s, uint16_t fg) {
  int w = uiTextWidth(f, s);
  uiText(f, (UI_W - w) / 2, y, s, fg);
}

// Breaks text into lines no wider than maxw (at spaces). Returns how many lines (at most maxLines).
static int uiWrap(const NeddyFont &f, const char *s, int maxw, int *start, int *len, int maxLines) {
  int n = 0, i = 0, total = (int)strlen(s);
  while (i < total && n < maxLines) {
    while (i < total && s[i] == ' ') i++;
    if (i >= total) break;
    int lineStart = i, lineEnd = i, w = 0, lastSpace = -1, wAtSpace = 0;
    int j = i;
    while (j < total) {
      int c = (uint8_t)s[j];
      if (c < 32 || c > 127) c = '?';
      int a = f.adv[c - 32];
      if (w + a > maxw && j > lineStart) break;
      if (s[j] == ' ') { lastSpace = j; wAtSpace = w; }
      w += a; j++;
    }
    if (j >= total) lineEnd = total;
    else if (lastSpace > lineStart) { lineEnd = lastSpace; (void)wAtSpace; }
    else lineEnd = j;
    start[n] = lineStart; len[n] = lineEnd - lineStart; n++;
    i = lineEnd;
  }
  return n;
}

// Draws a paragraph, centred, and returns the y below it. Shows the LAST maxLines lines (the newest words).
static int uiParagraph(const NeddyFont &f, int y, const char *s, uint16_t fg, int maxw, int maxLines, int lineGap) {
  int start[40], len[40];
  int n = uiWrap(f, s, maxw, start, len, 40);
  int from = n > maxLines ? n - maxLines : 0;
  char tmp[120];
  for (int i = from; i < n; i++) {
    int l = len[i] < 119 ? len[i] : 119;
    memcpy(tmp, s + start[i], l); tmp[l] = 0;
    uiTextCentered(f, y, tmp, fg);
    y += lineGap;
  }
  return y;
}

// ------------------------------------------------------------------ the robot
struct UiPose {
  float scale;            // 1.0 = full size (NEDDY_BODY_W wide)
  float footX, footY;     // where his feet touch, on the screen
  float breath;           // -0.03 .. 0.03: a little taller and thinner, or the reverse
  float sway;             // pixels the head leans sideways (feet stay put)
  float eyeDx, eyeDy;     // where he is looking, in body pixels
  int eye;                // which eye picture
  uint16_t glow;          // colour of the light on the floor
};

#define UI_BAND 24
#define UI_STAGE_MAX_W 260
static uint16_t uiBand[UI_STAGE_MAX_W * UI_BAND];

// The rectangle the robot can ever cover at this size (with room for his movement).
static void uiStageRect(const UiPose &p, int *x, int *y, int *w, int *h) {
  float halfW = NEDDY_BODY_W * 0.5f * p.scale * 1.08f + 10;
  float top = p.footY - NEDDY_BODY_H * p.scale * 1.06f - 8;
  float bottom = p.footY + 12 * p.scale + 6;
  int x0 = (int)(p.footX - halfW), x1 = (int)(p.footX + halfW);
  int y0 = (int)top, y1 = (int)bottom;
  if (x0 < 0) x0 = 0;
  if (x1 > UI_W) x1 = UI_W;
  if (y0 < 0) y0 = 0;
  if (y1 > UI_H) y1 = UI_H;
  if (x1 - x0 > UI_STAGE_MAX_W) x1 = x0 + UI_STAGE_MAX_W;
  x0 &= ~1; y0 &= ~1; x1 = (x1 + 1) & ~1; y1 = (y1 + 1) & ~1;     // even, see uiText
  if (x1 > UI_W) x1 = UI_W;
  if (y1 > UI_H) y1 = UI_H;
  *x = x0; *y = y0; *w = x1 - x0; *h = y1 - y0;
}

static inline int uiClampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Draws the robot into the rectangle, a band of rows at a time (little memory, one screen write per band).
static void uiRenderStage(const UiPose &p, int sx0, int sy0, int sw, int sh) {
  const bool half = p.scale <= 0.72f;
  const uint16_t *src = half ? NEDDY_HALF : NEDDY_BODY;
  const int srcW = half ? NEDDY_HALF_W : NEDDY_BODY_W, srcH = half ? NEDDY_HALF_H : NEDDY_BODY_H;
  const float k = half ? 0.5f : 1.0f;                  // source pixels per full-size body pixel
  const float scaleX = p.scale * (1.0f - 0.5f * p.breath);
  const float scaleY = p.scale * (1.0f + p.breath);
  const float dsx = 1.0f / scaleX;
  const uint16_t *eyes = NEDDY_EYES + (size_t)p.eye * NEDDY_SPR_W * NEDDY_SPR_H;
  const float eyeCx = NEDDY_EYE_CX + p.eyeDx, eyeCy = NEDDY_EYE_CY + p.eyeDy;
  const int gr = (p.glow >> 11) & 31, gg = (p.glow >> 5) & 63, gb = p.glow & 31;
  const float grx = 70.0f * p.scale, gry = 9.0f * p.scale + 2;
  for (int by = 0; by < sh; by += UI_BAND) {
    int rows = sh - by < UI_BAND ? sh - by : UI_BAND;
    for (int r = 0; r < rows; r++) {
      int oy = sy0 + by + r;
      uint16_t *dst = uiBand + r * sw;
      float syf = NEDDY_BODY_H - (p.footY - (oy + 0.5f)) / scaleY;          // full-size body row
      float v = syf * k - 0.5f;
      bool inBody = v > -1.0f && v < srcH;
      float gdy = (oy + 0.5f) - (p.footY - 2.0f);
      bool inGlow = fabsf(gdy) < gry;
      if (!inBody && !inGlow) { memset(dst, 0, (size_t)sw * 2); continue; }
      float sway = p.sway * (1.0f - syf / NEDDY_BODY_H);
      float sxf0 = ((sx0 + 0.5f) - p.footX - sway) * dsx + NEDDY_BODY_W * 0.5f;
      int iy = 0, fy = 0;
      if (inBody) {
        float vv = v < 0 ? 0 : v;
        iy = (int)vv; fy = (int)((vv - iy) * 256.0f);
        if (iy > srcH - 1) { iy = srcH - 1; fy = 0; }
      }
      int iy1 = iy + 1 > srcH - 1 ? srcH - 1 : iy + 1;
      const uint16_t *row0 = src + iy * srcW, *row1 = src + iy1 * srcW;
      float eyv = syf - eyeCy + NEDDY_SPR_H * 0.5f;
      bool eyeRow = eyv >= 0 && eyv < NEDDY_SPR_H;
      int eyi = eyeRow ? (int)eyv : 0;
      float gdy2 = (gdy * gdy) / (gry * gry);
      // Across the row in 16.16 fixed point: no floating point per pixel for the body (the board is much slower at it).
      int32_t u16 = (int32_t)((sxf0 * k - 0.5f) * 65536.0f);
      const int32_t du16 = (int32_t)(dsx * k * 65536.0f);
      int32_t e16 = (int32_t)((sxf0 - eyeCx + NEDDY_SPR_W * 0.5f) * 65536.0f);
      const int32_t de16 = (int32_t)(dsx * 65536.0f);
      const int32_t uMax = (srcW - 1) << 16;
      const int fyi = 256 - fy;
      for (int i = 0; i < sw; i++, u16 += du16, e16 += de16) {
        int r5 = 0, g6 = 0, b5 = 0;
        if (inBody) {
          int32_t u = u16 < 0 ? 0 : (u16 > uMax ? uMax : u16);
          int ix = u >> 16, fx = (u >> 8) & 255;
          int ix1 = ix + 1 > srcW - 1 ? srcW - 1 : ix + 1;
          uint16_t c00 = row0[ix], c10 = row0[ix1], c01 = row1[ix], c11 = row1[ix1];
          int w00 = (256 - fx) * fyi, w10 = fx * fyi, w01 = (256 - fx) * fy, w11 = fx * fy;
          r5 = (((c00 >> 11) * w00) + ((c10 >> 11) * w10) + ((c01 >> 11) * w01) + ((c11 >> 11) * w11)) >> 16;
          g6 = ((((c00 >> 5) & 63) * w00) + (((c10 >> 5) & 63) * w10) + (((c01 >> 5) & 63) * w01) + (((c11 >> 5) & 63) * w11)) >> 16;
          b5 = (((c00 & 31) * w00) + ((c10 & 31) * w10) + ((c01 & 31) * w01) + ((c11 & 31) * w11)) >> 16;
          if (eyeRow && e16 >= 0 && (e16 >> 16) < NEDDY_SPR_W) {
            uint16_t e = eyes[eyi * NEDDY_SPR_W + (e16 >> 16)];
            if (e) {
              r5 += e >> 11; g6 += (e >> 5) & 63; b5 += e & 31;
              if (r5 > 31) r5 = 31;
              if (g6 > 63) g6 = 63;
              if (b5 > 31) b5 = 31;
            }
          }
        }
        if (inGlow) {
          float gdx = ((sx0 + i + 0.5f) - p.footX) / grx;
          float d = gdx * gdx + gdy2;
          if (d < 1.0f) {
            float a = (1.0f - d); a = a * a * 0.55f;
            r5 += (int)(gr * a); g6 += (int)(gg * a); b5 += (int)(gb * a);
            if (r5 > 31) r5 = 31;
            if (g6 > 63) g6 = 63;
            if (b5 > 31) b5 = 31;
          }
        }
        dst[i] = (uint16_t)((r5 << 11) | (g6 << 5) | b5);
      }
    }
    uiOut.blit(sx0, sy0 + by, sw, rows, uiBand);
  }
}

// ------------------------------------------------------------------ the screen
enum { UI_READY, UI_LISTEN, UI_THINK, UI_SPEAK, UI_LINK };

static int uiMode = UI_LINK;
static char uiWords[300], uiHeard[120], uiName[24] = "Neddy", uiDiag1[72], uiDiag2[72];
static float uiLevel = 0;            // 0..1, how loud the person is (while listening)
static bool uiShowDiag = false;      // the two small lines of numbers at the bottom
static bool uiMotion = false;        // true: he moves all the time. false: still, except blinking.
static bool uiSmall = false;         // the layout now showing
static bool uiAll = true, uiTextDirty = true, uiLevelDirty = false;
static uint32_t uiNextBlink = 0, uiBlinkUntil = 0, uiNextGlance = 0, uiGlanceUntil = 0;
static float uiGlanceDx = 0;
static uint32_t uiRng = 12345;
static int uiLastEye = -1;
static int uiStageX = 0, uiStageY = 0, uiStageW = 0, uiStageH = 0;
static uint32_t uiLastStage = 0, uiLastText = 0;
// Optional: a clock in microseconds (the watch gives micros). With it, the screen measures how long drawing him takes
// and spaces the frames so drawing never takes more than a share of each turn of the main loop (the microphone and the
// link come first).
static uint32_t (*uiMicros)() = nullptr;
static float uiRenderMs = 0;         // how long one frame of him takes to draw (smoothed)

// ------------------------------------------------------------------ cards (the weather)
// A card is drawn from a few plain facts the server sends; it stays until the next press (or a minute), and he
// stays small at the bottom, still moving.
enum { UI_ICON_SUN, UI_ICON_MOON, UI_ICON_SUN_CLOUD, UI_ICON_PARTLY, UI_ICON_CLOUD, UI_ICON_SUN_RAIN, UI_ICON_RAIN,
       UI_ICON_STORM, UI_ICON_SNOW, UI_ICON_FOG, UI_ICON_WIND };
#define UI_NONE (-9999)
#define UI_ICON 112
struct UiCard {
  bool on;
  uint32_t since;
  char place[28], sky[44], alert[28];
  int temp, feels, high, low, rain, icon;
};
static UiCard uiCard;
static uint16_t uiIconBuf[UI_ICON * UI_ICON];
static uint32_t uiNowMs = 0;
#define UI_CARD_MS 60000

static uint32_t uiRand() { uiRng = uiRng * 1664525u + 1013904223u; return uiRng >> 8; }

static void uiClearCard() { if (uiCard.on) { uiCard.on = false; uiAll = true; } }
static void uiSetMode(int m) {
  if (m != uiMode) {
    uiMode = m; uiAll = true;
    if (m == UI_LISTEN || m == UI_LINK) uiCard.on = false;   // a new press or a lost link ends the card
  }
}
static void uiSetLevel(float l) {
  if (l < 0) l = 0;
  if (l > 1) l = 1;
  if (fabsf(l - uiLevel) > 0.03f) { uiLevel = l; uiLevelDirty = true; }
}
static void uiCopy(char *dst, size_t cap, const char *s) {
  size_t n = strlen(s);
  if (n >= cap) { s += n - (cap - 1); n = cap - 1; }   // keep the newest words
  if (strcmp(dst, s) != 0) uiTextDirty = true;
  memcpy(dst, s, n); dst[n] = 0;
}
static void uiSetWords(const char *s) { uiCopy(uiWords, sizeof(uiWords), s); }
static void uiSetHeard(const char *s) { uiCopy(uiHeard, sizeof(uiHeard), s); }
static void uiSetName(const char *s) { uiCopy(uiName, sizeof(uiName), s); }
static void uiSetDiag(const char *a, const char *b) { uiCopy(uiDiag1, sizeof(uiDiag1), a); uiCopy(uiDiag2, sizeof(uiDiag2), b); }

static uint16_t uiModeColour() {
  switch (uiMode) {
    case UI_LISTEN: return UI_CORAL;
    case UI_THINK: return UI_AMBER;
    case UI_SPEAK: return UI_CYAN;
    case UI_LINK: return UI_GREY;
    default: return UI_TEAL;
  }
}
static const char *uiModeLabel() {
  switch (uiMode) {
    case UI_LISTEN: return "Listening...";
    case UI_THINK: return "Thinking...";
    case UI_SPEAK: return "Neddy";
    case UI_LINK: return "Connecting to Neddy...";
    default: return "Hold BOOT to talk";
  }
}

// ---- the weather pictures: drawn from shapes with soft edges, once per card (no picture files)
static inline float uiClamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
static inline float uiCov(float d) { return uiClamp01(0.5f - d); }
static inline float sdCircle(float x, float y, float cx, float cy, float r) { float dx = x - cx, dy = y - cy; return sqrtf(dx * dx + dy * dy) - r; }
static inline float sdSeg(float x, float y, float x1, float y1, float x2, float y2, float r) {
  float px = x - x1, py = y - y1, ex = x2 - x1, ey = y2 - y1;
  float t = (px * ex + py * ey) / (ex * ex + ey * ey + 1e-6f);
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  float dx = px - ex * t, dy = py - ey * t;
  return sqrtf(dx * dx + dy * dy) - r;
}
static inline float sdBox(float x, float y, float cx, float cy, float hw, float hh, float r) {
  float qx = fabsf(x - cx) - (hw - r), qy = fabsf(y - cy) - (hh - r);
  float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  float in = qx > qy ? qx : qy; if (in > 0) in = 0;
  return sqrtf(ox * ox + oy * oy) + in - r;
}
static inline float sdCloud(float x, float y, float cx, float cy, float s) {
  float lx = (x - cx) / s, ly = (y - cy) / s;
  float d = sdCircle(lx, ly, -24, 4, 20);
  d = fminf(d, sdCircle(lx, ly, 2, -6, 27));
  d = fminf(d, sdCircle(lx, ly, 26, 6, 19));
  d = fminf(d, sdBox(lx, ly, 0, 10, 41, 13, 13));
  return d * s;
}
static inline void uiPaint(float *c, float cov, float r, float g, float b) {
  if (cov <= 0) return;
  c[0] += (r - c[0]) * cov; c[1] += (g - c[1]) * cov; c[2] += (b - c[2]) * cov;
}
static void uiSunLayer(float *c, float x, float y, float cx, float cy, float r, float rayIn, float rayOut) {
  float d = sqrtf((x - cx) * (x - cx) + (y - cy) * (y - cy));
  if (d > r) { float a = 1.0f - (d - r) / 30.0f; if (a > 0) uiPaint(c, a * a * 0.30f, 255, 196, 64); }   // glow
  if (d < rayOut + 3) {
    float ray = 1000;
    for (int k = 0; k < 8; k++) {
      float a = k * 0.785398f, ca = cosf(a), sa = sinf(a);
      float dd = sdSeg(x, y, cx + ca * rayIn, cy + sa * rayIn, cx + ca * rayOut, cy + sa * rayOut, 2.4f);
      if (dd < ray) ray = dd;
    }
    uiPaint(c, uiCov(ray), 255, 196, 64);
  }
  float t = uiClamp01((y - (cy - r)) / (2 * r));
  uiPaint(c, uiCov(d - r), 255 - 0 * t, 218 - 44 * t, 112 - 62 * t);
}
static void uiCloudLayer(float *c, float x, float y, float cx, float cy, float s, bool dark) {
  float cov = uiCov(sdCloud(x, y, cx, cy, s));
  if (cov <= 0) return;
  float t = uiClamp01((y - (cy - 33 * s)) / (56 * s));
  if (dark) uiPaint(c, cov, 134 - 46 * t, 148 - 48 * t, 166 - 48 * t);
  else uiPaint(c, cov, 242 - 64 * t, 247 - 55 * t, 252 - 42 * t);
}
static void uiDrop(float *c, float x, float y, float x0, float y0) {
  uiPaint(c, uiCov(sdSeg(x, y, x0, y0, x0 - 5, y0 + 13, 2.6f)), 110, 190, 255);
}
static void uiFlake(float *c, float x, float y, float cx, float cy) {
  float d = 1000;
  for (int k = 0; k < 3; k++) {
    float a = k * 1.047198f, ca = cosf(a) * 8, sa = sinf(a) * 8;
    float dd = sdSeg(x, y, cx - ca, cy - sa, cx + ca, cy + sa, 1.5f);
    if (dd < d) d = dd;
  }
  uiPaint(c, uiCov(d), 214, 232, 255);
}
static void uiHook(float *c, float x, float y, float x1, float x2, float yy, float hy, bool up) {
  float d = sdSeg(x, y, x1, yy, x2, yy, 3.0f);
  float dx = x - x2, dy = y - hy;
  if (x >= x2 && ((up && y <= yy + 2) || (!up && y >= yy - 2))) { float r = sqrtf(dx * dx + dy * dy) - 6.0f; float dd = fabsf(r) - 3.0f; if (dd < d) d = dd; }
  uiPaint(c, uiCov(d), 170, 202, 228);
}
static void uiIconPixel(int icon, float x, float y, float *c) {
  switch (icon) {
    case UI_ICON_SUN: uiSunLayer(c, x, y, 56, 56, 22, 33, 46); break;
    case UI_ICON_MOON: {
      float d = fmaxf(sdCircle(x, y, 50, 56, 27), -sdCircle(x, y, 64, 46, 23));
      uiPaint(c, uiCov(d), 240, 234, 190);
      uiPaint(c, uiCov(sdCircle(x, y, 86, 28, 2.6f)), 236, 236, 214);
      uiPaint(c, uiCov(sdCircle(x, y, 94, 54, 2.0f)), 236, 236, 214);
      break;
    }
    case UI_ICON_SUN_CLOUD: uiSunLayer(c, x, y, 40, 40, 16, 23, 32); uiCloudLayer(c, x, y, 62, 68, 0.78f, false); break;
    case UI_ICON_PARTLY: uiSunLayer(c, x, y, 38, 38, 15, 22, 31); uiCloudLayer(c, x, y, 60, 66, 1.0f, false); break;
    case UI_ICON_CLOUD: uiCloudLayer(c, x, y, 70, 48, 0.7f, true); uiCloudLayer(c, x, y, 52, 66, 0.95f, false); break;
    case UI_ICON_SUN_RAIN:
      uiSunLayer(c, x, y, 38, 34, 14, 20, 28);
      uiCloudLayer(c, x, y, 62, 56, 0.85f, false);
      uiDrop(c, x, y, 44, 82); uiDrop(c, x, y, 62, 88); uiDrop(c, x, y, 80, 82);
      break;
    case UI_ICON_RAIN:
      uiCloudLayer(c, x, y, 56, 46, 0.95f, true);
      uiDrop(c, x, y, 34, 80); uiDrop(c, x, y, 50, 88); uiDrop(c, x, y, 66, 80); uiDrop(c, x, y, 82, 88);
      break;
    case UI_ICON_STORM: {
      uiCloudLayer(c, x, y, 56, 44, 0.95f, true);
      float d = sdSeg(x, y, 62, 62, 48, 84, 3.4f);
      d = fminf(d, sdSeg(x, y, 48, 84, 60, 84, 3.4f));
      d = fminf(d, sdSeg(x, y, 60, 84, 46, 106, 3.4f));
      uiPaint(c, uiCov(d), 255, 204, 72);
      break;
    }
    case UI_ICON_SNOW:
      uiCloudLayer(c, x, y, 56, 44, 0.95f, false);
      uiFlake(c, x, y, 34, 88); uiFlake(c, x, y, 56, 100); uiFlake(c, x, y, 78, 88);
      break;
    case UI_ICON_FOG: {
      uiCloudLayer(c, x, y, 56, 36, 0.8f, true);
      float d = sdSeg(x, y, 22, 68, 90, 68, 3.5f);
      d = fminf(d, sdSeg(x, y, 30, 82, 98, 82, 3.5f));
      d = fminf(d, sdSeg(x, y, 22, 96, 78, 96, 3.5f));
      uiPaint(c, uiCov(d), 172, 186, 200);
      break;
    }
    default:  // wind
      uiHook(c, x, y, 14, 72, 38, 32, true);
      uiHook(c, x, y, 14, 88, 56, 62, false);
      uiHook(c, x, y, 26, 66, 76, 70, false);
      break;
  }
}
static void uiRenderIcon(int icon, uint16_t bg) {
  const float br = ((bg >> 11) & 31) * 255.0f / 31, bgc = ((bg >> 5) & 63) * 255.0f / 63, bb = (bg & 31) * 255.0f / 31;
  for (int y = 0; y < UI_ICON; y++) {
    for (int x = 0; x < UI_ICON; x++) {
      float c[3] = { br, bgc, bb };
      uiIconPixel(icon, x + 0.5f, y + 0.5f, c);
      int r = (int)(c[0] + 0.5f), g = (int)(c[1] + 0.5f), b = (int)(c[2] + 0.5f);
      if (r > 255) r = 255;
      if (g > 255) g = 255;
      if (b > 255) b = 255;
      uiIconBuf[y * UI_ICON + x] = uiRgb(r, g, b);
    }
  }
}

// A rounded panel: straight parts as rectangles, the four corners as small soft-edged tiles.
static void uiRoundPanel(int x, int y, int w, int h, int R, uint16_t border, uint16_t fill) {
  uiOut.fill(x + R, y, w - 2 * R, 2, border);
  uiOut.fill(x + R, y + h - 2, w - 2 * R, 2, border);
  uiOut.fill(x + R, y + 2, w - 2 * R, h - 4, fill);
  uiOut.fill(x, y + R, 2, h - 2 * R, border);
  uiOut.fill(x + w - 2, y + R, 2, h - 2 * R, border);
  uiOut.fill(x + 2, y + R, w - 4, h - 2 * R, fill);
  const int bR = (border >> 11) & 31, bG = (border >> 5) & 63, bB = border & 31;
  const int fR = (fill >> 11) & 31, fG = (fill >> 5) & 63, fB = fill & 31;
  for (int corner = 0; corner < 4; corner++) {
    bool right = corner & 1, bottom = corner & 2;
    for (int ty = 0; ty < R; ty++) {
      for (int tx = 0; tx < R; tx++) {
        int sx = right ? R - 1 - tx : tx, sy = bottom ? R - 1 - ty : ty;
        float dx = sx + 0.5f - R, dy = sy + 0.5f - R;
        float d = sqrtf(dx * dx + dy * dy);
        float co = uiCov(d - R), ci = uiCov(d - (R - 2));
        float r = bR * co, g = bG * co, b = bB * co;      // black outside, border ring, then the fill
        r += (fR - r) * ci; g += (fG - g) * ci; b += (fB - b) * ci;
        uiBand[ty * R + tx] = (uint16_t)(((int)(r + 0.5f) << 11) | ((int)(g + 0.5f) << 5) | (int)(b + 0.5f));
      }
    }
    uiOut.blit(right ? x + w - R : x, bottom ? y + h - R : y, R, R, uiBand);
  }
}

static void uiNumDeg(char *out, int v) { snprintf(out, 12, "%d%c", v, (char)127); }

static void uiDrawCard() {
  const int PX = 14, PY = 10, PW = 382, PH = 336;
  const uint16_t panel = uiRgb(20, 28, 36), border = uiRgb(52, 74, 88);
  uiRoundPanel(PX, PY, PW, PH, 24, border, panel);
  uiBg = panel;
  char buf[48];
  // the place, in capitals
  int n = 0;
  for (const char *p = uiCard.place; *p && n < 30; p++) buf[n++] = (*p >= 'a' && *p <= 'z') ? (char)(*p - 32) : *p;
  buf[n] = 0;
  uiTextCentered(NFONT_MID, 16, buf, UI_TEAL);
  // the picture on the left, the temperature on the right
  uiRenderIcon(uiCard.icon, panel);
  uiOut.blit(34, 48, UI_ICON, UI_ICON, uiIconBuf);
  uiNumDeg(buf, uiCard.temp);
  int tw = uiTextWidth(NFONT_TEMP, buf);
  uiText(NFONT_TEMP, 272 - tw / 2, 48 + (UI_ICON - NFONT_TEMP.h) / 2, buf, UI_WHITE);
  // what it's like: the sky, then a warning (or what it feels like), centred in the room between
  int start[2], len[2];
  int lines = uiWrap(NFONT_BODY, uiCard.sky, 340, start, len, 2);
  bool extra = uiCard.alert[0] || uiCard.feels != UI_NONE;
  int contentH = lines * 32 + (extra ? 28 : 0);
  int y = 164 + (94 - contentH) / 2;
  char line[48];
  for (int i = 0; i < lines; i++) {
    int l = len[i] < 47 ? len[i] : 47;
    memcpy(line, uiCard.sky + start[i], l); line[l] = 0;
    uiTextCentered(NFONT_BODY, y, line, UI_WHITE);
    y += 32;
  }
  if (uiCard.alert[0]) uiTextCentered(NFONT_MID, y, uiCard.alert, UI_CORAL);
  else if (uiCard.feels != UI_NONE) {
    char f[12]; uiNumDeg(f, uiCard.feels);
    snprintf(line, sizeof(line), "Feels like %s", f);
    uiTextCentered(NFONT_MID, y, line, UI_GREY);
  }
  // today's high and low, and the chance of rain, in small tiles
  struct Tile { const char *label; char value[12]; uint16_t colour; } tiles[3];
  int count = 0;
  if (uiCard.high != UI_NONE) { tiles[count].label = "High"; uiNumDeg(tiles[count].value, uiCard.high); tiles[count].colour = UI_AMBER; count++; }
  if (uiCard.low != UI_NONE) { tiles[count].label = "Low"; uiNumDeg(tiles[count].value, uiCard.low); tiles[count].colour = UI_CYAN; count++; }
  if (uiCard.rain > 0) { tiles[count].label = "Rain"; snprintf(tiles[count].value, 12, "%d%%", uiCard.rain); tiles[count].colour = UI_TEAL; count++; }
  if (count) {
    uiOut.fill(PX + 28, 262, PW - 56, 2, border);
    for (int i = 0; i < count; i++) {
      int cx = 205 + (int)((i - (count - 1) / 2.0f) * 118);
      uiText(NFONT_MID, cx - uiTextWidth(NFONT_MID, tiles[i].label) / 2, 268, tiles[i].label, UI_GREY);
      uiText(NFONT_BODY, cx - uiTextWidth(NFONT_BODY, tiles[i].value) / 2, 296, tiles[i].value, tiles[i].colour);
    }
  }
  uiBg = UI_BLACK;
}

// The server names the picture; unknown names get a plain cloud.
static int uiIconByName(const char *name) {
  static const char *names[] = { "sun", "moon", "sun-cloud", "partly", "cloud", "sun-rain", "rain", "storm", "snow", "fog", "wind" };
  for (int i = 0; i < 11; i++) if (strcmp(name, names[i]) == 0) return i;
  return UI_ICON_CLOUD;
}
static void uiCopyTrim(char *dst, size_t cap, const char *s) {
  size_t n = strlen(s);
  if (n >= cap) n = cap - 1;
  memcpy(dst, s, n); dst[n] = 0;
}
// Shows the weather card. Numbers the server didn't send are UI_NONE.
static void uiShowWeather(uint32_t ms, const char *place, int temp, int feels, const char *sky, int icon, int high, int low, int rain, const char *alert) {
  uiCopyTrim(uiCard.place, sizeof(uiCard.place), place);
  uiCopyTrim(uiCard.sky, sizeof(uiCard.sky), sky);
  uiCopyTrim(uiCard.alert, sizeof(uiCard.alert), alert);
  uiCard.temp = temp; uiCard.feels = feels; uiCard.high = high; uiCard.low = low; uiCard.rain = rain;
  uiCard.icon = icon < 0 || icon > UI_ICON_WIND ? UI_ICON_CLOUD : icon;
  uiCard.since = ms; uiCard.on = true; uiAll = true;
}

static void uiBasePose(UiPose *p) {
  p->breath = 0; p->sway = 0; p->eyeDx = 0; p->eyeDy = 0; p->eye = EYE_HAPPY;
  p->glow = uiModeColour();
  if (uiSmall) { p->scale = 0.4f; p->footX = UI_W / 2.0f; p->footY = UI_H - 14.0f; }   // small, tucked at the bottom middle
  else { p->scale = 1.0f; p->footX = UI_W / 2.0f; p->footY = 14 + NEDDY_BODY_H; }
}

static void uiTextAreas(int *top, int *bottom) {
  if (uiSmall) { *top = 12; *bottom = uiStageY - 4; }                      // words fill the top, he waits below
  else { *top = uiStageY + uiStageH + 2; *bottom = uiShowDiag ? 450 : 496; }
  *top &= ~1; *bottom &= ~1;
}

static int uiLevelY() {
  int top, bottom;
  uiTextAreas(&top, &bottom);
  return (top + 2 + NFONT_TITLE.h + 8) & ~1;
}

static void uiDrawText() {
  if (uiCard.on) { uiDrawCard(); return; }
  int top, bottom;
  uiTextAreas(&top, &bottom);
  uiOut.fill(0, top, UI_W, bottom - top, UI_BLACK);
  uint16_t col = uiModeColour();
  uiTextCentered(NFONT_TITLE, top + 2, uiModeLabel(), col);
  int y = uiLevelY();
  if (uiMode == UI_LISTEN) {
    // a rounded level bar
    int bx = 76, bw = 258, by = y + 6;
    uiOut.fill(bx, by, bw, 18, uiRgb(70, 74, 80));
    uiOut.fill(bx + 2, by + 2, bw - 4, 14, UI_BLACK);
    int fw = ((int)((bw - 4) * uiLevel)) & ~1;
    if (fw > 0) uiOut.fill(bx + 2, by + 2, fw, 14, col);
    return;
  }
  if (uiHeard[0]) y = uiParagraph(NFONT_MID, y, uiHeard, UI_GREY, 354, 2, NFONT_MID.h + 2) + 6;
  if (uiWords[0]) {
    int step = NFONT_BODY.h + 4;
    int lines = (bottom - y) / step;
    if (lines > 9) lines = 9;
    if (lines > 0) uiParagraph(NFONT_BODY, y, uiWords, UI_WHITE, 354, lines, step);
  } else if (!uiSmall && uiName[0]) {
    uiTextCentered(NFONT_MID, y, uiName, UI_GREY);
  }
}

static void uiDrawLevelOnly() {
  int y = uiLevelY(), bx = 76, bw = 258, by = y + 6;
  uiOut.fill(bx + 2, by + 2, bw - 4, 14, UI_BLACK);
  int fw = ((int)((bw - 4) * uiLevel)) & ~1;
  if (fw > 0) uiOut.fill(bx + 2, by + 2, fw, 14, uiModeColour());
}

static void uiDrawDiag() {
  if (!uiShowDiag) return;
  uiOut.fill(0, 452, UI_W, 50, UI_BLACK);
  if (uiDiag1[0]) uiTextCentered(NFONT_SMALL, 456, uiDiag1, UI_DIM);
  if (uiDiag2[0]) uiTextCentered(NFONT_SMALL, 474, uiDiag2, UI_DIM);
}

// Which eye picture, and where he looks, right now.
static void uiEyes(uint32_t ms, UiPose *p) {
  int eye = EYE_HAPPY;
  switch (uiMode) {
    case UI_LISTEN: { int q = (int)(uiLevel * 3.99f); eye = EYE_WIDE0 + q; break; }
    case UI_THINK: eye = EYE_THINK; break;
    case UI_SPEAK: eye = ((ms / 170) & 1) && uiMotion ? EYE_HAPPY : EYE_SPEAK; break;
    case UI_LINK: eye = EYE_DIM; break;
    default: eye = EYE_HAPPY;
  }
  if (uiMode == UI_READY || uiMode == UI_SPEAK) {
    if (ms >= uiNextBlink) { uiBlinkUntil = ms + 140; uiNextBlink = ms + 2500 + (uiRand() % 3500); }
    if (ms < uiBlinkUntil) eye = EYE_BLINK;
  }
  if (uiMotion) {
    if (uiMode == UI_READY && ms >= uiNextGlance) { uiGlanceUntil = ms + 800; uiNextGlance = ms + 4000 + (uiRand() % 5000); uiGlanceDx = (uiRand() & 1) ? 4.0f : -4.0f; }
    if (ms < uiGlanceUntil) p->eyeDx = uiGlanceDx;
    if (uiMode == UI_THINK) p->eyeDx = 4.0f * sinf(ms * 0.0028f);
  }
  p->eye = eye;
}

static void uiPoseNow(uint32_t ms, UiPose *p) {
  uiBasePose(p);
  if (uiMotion) {
    float t = ms * 0.001f;
    float amp = 1.0f, speed = 1.0f;
    if (uiMode == UI_SPEAK) { amp = 1.8f; speed = 2.2f; }
    if (uiMode == UI_THINK) { amp = 1.2f; speed = 1.4f; }
    float bob = sinf(t * 1.26f * speed) * 3.0f * amp * p->scale;
    p->footY += bob;
    p->breath = sinf(t * 1.85f * speed) * 0.012f;
    p->sway = sinf(t * 0.97f * speed) * (uiMode == UI_THINK ? 5.0f : 3.0f) * p->scale * 2.0f;
    if (uiMode == UI_LISTEN) p->scale *= 1.02f;
  }
  uiEyes(ms, p);
}

// Call as often as you like (every loop turn). Draws only what has changed; when he moves, about every 60 ms.
static void uiDrawStage(const UiPose &p) {
  uint32_t t0 = uiMicros ? uiMicros() : 0;
  uiRenderStage(p, uiStageX, uiStageY, uiStageW, uiStageH);
  if (uiMicros) {
    float took = (uiMicros() - t0) / 1000.0f;
    uiRenderMs = uiRenderMs <= 0 ? took : uiRenderMs * 0.8f + took * 0.2f;
  }
}

static void uiTick(uint32_t ms) {
  uiNowMs = ms;
  if (uiCard.on && ms - uiCard.since >= UI_CARD_MS) uiClearCard();
  bool wantSmall = uiCard.on || ((uiWords[0] || uiHeard[0]) && uiMode != UI_LISTEN && uiMode != UI_LINK);
  if (wantSmall != uiSmall) { uiSmall = wantSmall; uiAll = true; }
  UiPose p;
  uiPoseNow(ms, &p);
  if (uiAll) {
    uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
    UiPose nominal; uiBasePose(&nominal);
    uiStageRect(nominal, &uiStageX, &uiStageY, &uiStageW, &uiStageH);
    uiDrawText();
    uiDrawDiag();
    uiDrawStage(p);
    uiAll = false; uiTextDirty = false; uiLevelDirty = false; uiLastEye = p.eye; uiLastStage = ms;
    return;
  }
  // A card is drawn once (words that arrive meanwhile wait behind it); the level bar only shows while listening.
  if (uiTextDirty && ms - uiLastText >= 120) { if (!uiCard.on) { uiDrawText(); uiDrawDiag(); } uiTextDirty = false; uiLevelDirty = false; uiLastText = ms; }
  else if (uiLevelDirty) { if (uiMode == UI_LISTEN && !uiCard.on) uiDrawLevelOnly(); uiLevelDirty = false; }
  bool draw = false;
  if (p.eye != uiLastEye) draw = true;                       // eyes changed (blink, listening level...)
  // Moving: about 16 frames a second, but never more often than drawing allows (drawing may take 40% of the time at most;
  // while he is listening, only 20%, so no sound is missed).
  uint32_t gap = 60;
  if (uiMicros) {
    float share = uiMode == UI_LISTEN ? 5.0f : 2.5f;
    uint32_t need = (uint32_t)(uiRenderMs * share);
    if (need > gap) gap = need;
    if (uiMode == UI_LISTEN && gap < 150) gap = 150;
  }
  if (uiMotion && ms - uiLastStage >= gap) draw = true;
  if (draw) {
    uiDrawStage(p);
    uiLastEye = p.eye; uiLastStage = ms;
  }
}
