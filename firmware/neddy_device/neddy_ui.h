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
#include "neddy_qr.h"

#define UI_W 410
#define UI_H 502

// Where pixels go (set by the sketch, or by the PC test).
struct UiOut {
  void (*blit)(int x, int y, int w, int h, uint16_t *px);
  void (*fill)(int x, int y, int w, int h, uint16_t colour);
  void (*brightness)(int level);   // optional: 0..255
  void (*setting)(int which, int value);   // optional: the person changed a setting on the watch (1 = animation speed, 2 = face)
  void (*record)(int action);              // optional: the recording screen or menu asked for something (UI_REC_* below)
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
static constexpr uint16_t UI_GREEN = uiRgb(110, 226, 160);

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
  float bottom = p.footY + 26 * p.scale + 6;       // room under the feet for the look-up flames
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
// ---- looking something up: Neddy reads a blue book and two small flames flicker under his feet. Drawn into each band as it is made,
// only while a look-up runs (the server says when), so it costs nothing the rest of the time.
static bool uiLookupOn = false;
static uint32_t uiLookupSince = 0, uiLookupNow = 0;
static inline void uiMix(uint16_t *px, int r8, int g8, int b8, int a256) {   // blends a colour over a pixel
  int r = (*px >> 11) & 31, g = (*px >> 5) & 63, b = *px & 31;
  r = (r * (256 - a256) + (r8 >> 3) * a256) >> 8; g = (g * (256 - a256) + (g8 >> 2) * a256) >> 8; b = (b * (256 - a256) + (b8 >> 3) * a256) >> 8;
  *px = (uint16_t)((r << 11) | (g << 5) | b);
}
static void uiOverlayLookup(const UiPose &p, uint16_t *band, int sx0, int oy0, int sw, int rows) {
  const float s = p.scale;
  const float t = uiLookupNow * 0.001f;
  // flames: a teardrop under each foot, white-yellow at the top to red at the tip, never the same length twice
  for (int foot = 0; foot < 2; foot++) {
    const float fx = p.footX + (foot ? 26.0f : -26.0f) * s;
    const float len = (21.0f + 7.0f * sinf(t * 31.0f + foot * 2.1f) + 3.0f * sinf(t * 53.0f + foot)) * s;
    const float top = p.footY - 1.0f * s;
    const float halfW = 8.0f * s;
    for (int r = 0; r < rows; r++) {
      float y = oy0 + r + 0.5f, dy = y - top;
      if (dy < 0 || dy > len) continue;
      float k = dy / len;
      float hw = halfW * (1.0f - k * k) + 0.5f;
      int xa = (int)(fx - hw) - sx0, xb = (int)(fx + hw) - sx0;
      for (int x = xa < 0 ? 0 : xa; x <= xb && x < sw; x++) {
        float edge = 1.0f - fabsf((sx0 + x + 0.5f) - fx) / (hw + 0.01f);
        int a = (int)(256.0f * (1.0f - k * 0.55f) * (edge < 0.25f ? edge * 4.0f : 1.0f));
        if (k < 0.3f) uiMix(&band[r * sw + x], 255, 240, 170, a);
        else if (k < 0.65f) uiMix(&band[r * sw + x], 255, 150, 40, a);
        else uiMix(&band[r * sw + x], 210, 50, 14, a);
      }
    }
  }
  // the book: two pages tilted like an open book held in front of his chest, with lines of text and a page that flips now and then
  const float cx = p.footX, bw = 60.0f * s, bh = 46.0f * s;
  const float cy = p.footY - 0.47f * NEDDY_BODY_H * s;
  const float top0 = cy - bh * 0.5f, tilt = 0.30f;
  float flip = fmodf(t, 1.6f) / 0.4f;                       // 0..1 while a page turns, then still
  for (int r = 0; r < rows; r++) {
    float y = oy0 + r + 0.5f;
    if (y < top0 - bw * tilt - 1 || y > cy + bh * 0.5f + 1) continue;
    int xa = (int)(cx - bw) - sx0, xb = (int)(cx + bw) - sx0;
    for (int x = xa < 0 ? 0 : xa; x <= xb && x < sw; x++) {
      float u = (sx0 + x + 0.5f) - cx, au = fabsf(u);
      if (au < 0.5f) { band[r * sw + x] = uiRgb(10, 36, 110); continue; }   // the spine
      float rise = au * tilt;                                  // the pages rise toward the outer edge
      float yTop = top0 - rise, yBot = cy + bh * 0.5f - rise * 0.2f;
      if (y < yTop || y > yBot) continue;
      bool edge = y < yTop + 1.6f * s + 1 || y > yBot - 1.6f * s - 1 || au > bw - 1.6f * s - 1;
      uint16_t *px = &band[r * sw + x];
      if (edge) { *px = uiRgb(120, 175, 255); continue; }
      *px = uiRgb(34, 100, 232);
      float row = (y - yTop) / (4.5f * s + 1);                 // lines of text, every ~4.5 px
      if (fabsf(row - floorf(row) - 0.5f) < 0.22f && au > 5 * s && au < bw - 5 * s && (y - yTop) > 5 * s) uiMix(px, 170, 210, 255, 190);
    }
  }
  if (flip < 1.0f) {                                          // the turning page: a light strip that sweeps from right to left
    float fxp = cx + bw * cosf(3.14159f * flip);
    float wdt = 5.0f * s + 1;
    for (int r = 0; r < rows; r++) {
      float y = oy0 + r + 0.5f;
      float au = fabsf(fxp - cx), rise = au * tilt;
      if (y < top0 - rise || y > cy + bh * 0.5f - rise * 0.2f) continue;
      int xa = (int)(fxp - wdt) - sx0, xb = (int)(fxp + wdt) - sx0;
      for (int x = xa < 0 ? 0 : xa; x <= xb && x < sw; x++) uiMix(&band[r * sw + x], 205, 228, 255, 210);
    }
  }
}

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
    if (uiLookupOn) uiOverlayLookup(p, uiBand, sx0, sy0 + by, sw, rows);
    uiOut.blit(sx0, sy0 + by, sw, rows, uiBand);
  }
}

// ------------------------------------------------------------------ the screen
enum { UI_READY, UI_LISTEN, UI_THINK, UI_SPEAK, UI_LINK };

static int uiMode = UI_LINK;
static char uiWords[300], uiHeard[120], uiName[24] = "Neddy", uiDiag1[72], uiDiag2[72], uiIdleDbg[72];
static float uiLevel = 0;            // 0..1, how loud the person is (while listening)
static bool uiShowDiag = false;      // the two small lines of numbers at the bottom
static bool uiMotion = false;        // true: he moves all the time. false: still, except blinking.
static bool uiSmall = false;         // the layout now showing
static bool uiAll = true, uiTextDirty = true, uiLevelDirty = false, uiDiagDirty = false;
static uint32_t uiNextBlink = 0, uiBlinkUntil = 0, uiNextGlance = 0, uiGlanceUntil = 0;
static float uiGlanceDx = 0;
static uint32_t uiRng = 12345;
static int uiLastEye = -1;
static int uiStageX = 0, uiStageY = 0, uiStageW = 0, uiStageH = 0;
static uint32_t uiLastStage = 0, uiLastText = 0, uiLastDiag = 0;
static int uiFrames = 0, uiFpsNow = 0;   // frames of Neddy drawn in the last second (for the test line)
static uint32_t uiFpsAt = 0;
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
enum { UI_CARD_WEATHER, UI_CARD_SCORE, UI_CARD_FACT, UI_CARD_LIST, UI_CARD_MENU };
struct UiCard {
  bool on;
  int kind;
  uint32_t since;
  char place[28], sky[44], alert[28];      // weather (a fact's label is `place`, its value `sky`, its line `alert`)
  int temp, feels, high, low, rain, icon;
  char league[20], status[28], away[20], home[20];   // a score
  int awayScore, homeScore;
  char value[24], sub[48], note[40];       // a fact
  int tone;                                // 0 plain, 1 good, 2 bad
  int rows;                                // a list: up to five rows
  char rowLabel[5][30], rowValue[5][16];
};
static UiCard uiCard;
static uint16_t uiIconBuf[UI_ICON * UI_ICON];
static uint32_t uiNowMs = 0;
#define UI_CARD_MS 60000

// ---- the idle face: the time, the weather, the next meeting; shown after a quiet spell
struct UiIdle {
  bool have;                      // the server has told us the time
  uint32_t baseUtc, baseMs;       // the server's time (seconds since 1970, UTC) and our clock when it arrived
  int off;                        // the person's offset from UTC, in minutes
  int after;                      // seconds of quiet before the idle face (0 = never)
  bool dim, showW, showM;
  bool haveW; int wt, wi, wh, wl; char ws[32];
  bool mc, haveM;                 // the calendar was read / there is a next meeting
  char mt[32]; uint32_t ms, me;   // its title, start and end (UTC seconds)
  bool showB; int bat; bool chg;  // the battery level: shown, percent (-1 = no battery / unknown), charging
  int mv; bool vbus;              // battery millivolts (0 = not read) and whether USB power is present
};
static UiIdle uiIdle = { false, 0, 0, 0, 10, true, true, true, false, 0, 0, 0, 0, "", false, false, "", 0, 0, true, -1, false, 0, false };
static uint8_t uiBatRaw[2] = { 0, 0 };   // the power chip's two status bytes, for the test line
static bool uiIdleOn = false, uiDimmed = false;
static uint32_t uiLastActive = 0, uiIdleSince = 0;
static int uiIdleMinute = -1;
// How long a card stays: as long as the idle wait (10 s by default, never under 10), so the face comes back right after it; a minute when the idle face is off.
static uint32_t uiCardMs() { if (uiCard.on && uiCard.kind == UI_CARD_MENU) return 15000UL; return (uiIdle.have && uiIdle.after > 0) ? (uint32_t)(uiIdle.after < 10 ? 10 : uiIdle.after) * 1000UL : (uint32_t)UI_CARD_MS; }
// The battery level, read by the sketch every so often; the face redraws when it changes.
static void uiSetBattery(int pct, bool charging, uint8_t s1, uint8_t s2, int mv = 0, bool vbus = false) {
  if (pct != uiIdle.bat || charging != uiIdle.chg || vbus != uiIdle.vbus) uiIdleMinute = -1;
  uiIdle.bat = pct; uiIdle.chg = charging; uiBatRaw[0] = s1; uiBatRaw[1] = s2; uiIdle.mv = mv; uiIdle.vbus = vbus;
}
#define UI_IDLE_DIM_MS 60000
#define UI_DIM_LEVEL 40

// ---- touch: what he does when touched, and the cards he remembers
static uint32_t uiReactUntil = 0;            // a giggle in progress
static uint32_t uiLookUntil = 0;             // his eyes follow a finger until then
static int uiLookX = 0, uiLookY = 0;
static bool uiTouchTalk = false;             // a hold or a hands-free double tap wants the microphone (the sketch reads this)
#define UI_HIST 5
static UiCard uiHist[UI_HIST];
static int uiHistN = 0, uiHistAt = -1;

static uint32_t uiRand() { uiRng = uiRng * 1664525u + 1013904223u; return uiRng >> 8; }

static void uiLookup(uint32_t ms, bool on) { if (on != uiLookupOn) { uiLookupOn = on; uiLookupSince = ms; } }
static void uiClearCard() { if (uiCard.on) { uiCard.on = false; uiAll = true; } }
// Anything happening (a touch, a press, words, a card) wakes the idle face and restarts the wait for it.
static bool uiScreenOff = false;                 // the menu's Screen off: dark and not drawing until any touch, press or words
static void uiActivity(uint32_t ms) {
  uiLastActive = ms;
  if (uiScreenOff) { uiScreenOff = false; uiAll = true; if (uiOut.brightness) uiOut.brightness(255); }
  if (uiIdleOn) {
    uiIdleOn = false; uiAll = true;
    if (uiDimmed) { uiDimmed = false; if (uiOut.brightness) uiOut.brightness(255); }
  }
}
static void uiSetMode(int m) {
  if (m != uiMode) {
    uiActivity(uiNowMs);
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
  if (strcmp(dst, s) != 0) { uiTextDirty = true; uiActivity(uiNowMs); }
  memcpy(dst, s, n); dst[n] = 0;
}
// The same, but not "someone is using it": the small diagnostic lines change every second (Wi-Fi strength, timings).
static void uiCopyQuiet(char *dst, size_t cap, const char *s) {
  size_t n = strlen(s);
  if (n >= cap) { s += n - (cap - 1); n = cap - 1; }
  if (strcmp(dst, s) != 0) uiDiagDirty = true;   // only the small bottom lines change: never redraw the words for that
  memcpy(dst, s, n); dst[n] = 0;
}
static void uiSetWords(const char *s) { uiCopy(uiWords, sizeof(uiWords), s); }
static void uiSetHeard(const char *s) { uiCopy(uiHeard, sizeof(uiHeard), s); }
static void uiSetName(const char *s) { uiCopy(uiName, sizeof(uiName), s); }
static void uiSetDiag(const char *a, const char *b) { uiCopyQuiet(uiDiag1, sizeof(uiDiag1), a); uiCopyQuiet(uiDiag2, sizeof(uiDiag2), b); }

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

static void uiDrawWeather() {
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

// ---- the other cards: a score, one headline fact, a short list
static void uiUpper(char *dst, size_t cap, const char *src) {
  size_t n = 0;
  for (; src[n] && n + 1 < cap; n++) dst[n] = (src[n] >= 'a' && src[n] <= 'z') ? (char)(src[n] - 32) : src[n];
  dst[n] = 0;
}
// Copies text, shortened with a "." until it fits the width.
static void uiFit(char *dst, size_t cap, const NeddyFont &f, const char *src, int maxw) {
  size_t n = strlen(src);
  if (n >= cap) n = cap - 1;
  memcpy(dst, src, n); dst[n] = 0;
  while (n > 1 && uiTextWidth(f, dst) > maxw) {
    n--; dst[n - 1] = '.'; dst[n] = 0;
    while (n > 2 && dst[n - 2] == ' ') { dst[n - 2] = '.'; dst[n - 1] = 0; n--; }   // no space before the dot
  }
}
static void uiCardHeader(const char *text) {
  if (!text[0]) return;
  char buf[32];
  uiUpper(buf, sizeof(buf), text);
  uiTextCentered(NFONT_MID, 16, buf, UI_TEAL);
}

static void uiDrawScore() {
  const int PX = 14, PW = 382;
  const uint16_t border = uiRgb(52, 74, 88);
  uiCardHeader(uiCard.league);
  char buf[24];
  if (uiCard.awayScore != UI_NONE && uiCard.homeScore != UI_NONE) {
    // Two rows, the team on the left and its score big on the right; when it isn't level, the leader is the bright one.
    int leader = uiCard.awayScore > uiCard.homeScore ? 0 : (uiCard.homeScore > uiCard.awayScore ? 1 : -1);
    for (int r = 0; r < 2; r++) {
      int y0 = 50 + r * 110;
      uint16_t col = (leader < 0 || leader == r) ? UI_WHITE : UI_GREY;
      uiFit(buf, sizeof(buf), NFONT_BODY, r == 0 ? uiCard.away : uiCard.home, 196);
      uiText(NFONT_BODY, 34, y0 + (NFONT_TEMP.h - NFONT_BODY.h) / 2, buf, col);
      snprintf(buf, sizeof(buf), "%d", r == 0 ? uiCard.awayScore : uiCard.homeScore);
      uiText(NFONT_TEMP, 376 - uiTextWidth(NFONT_TEMP, buf), y0, buf, col);
    }
    uiOut.fill(PX + 28, 160, PW - 56, 2, border);
    if (uiCard.status[0]) uiTextCentered(NFONT_BODY, 284, uiCard.status, UI_TEAL);
  } else {
    // Not started: the two names, "at", and when.
    uiFit(buf, sizeof(buf), NFONT_TITLE, uiCard.away, 340);
    uiTextCentered(NFONT_TITLE, 70, buf, UI_WHITE);
    uiTextCentered(NFONT_MID, 126, "at", UI_GREY);
    uiFit(buf, sizeof(buf), NFONT_TITLE, uiCard.home, 340);
    uiTextCentered(NFONT_TITLE, 160, buf, UI_WHITE);
    if (uiCard.status[0]) uiTextCentered(NFONT_BODY, 250, uiCard.status, UI_TEAL);
  }
}

// A value like "24 min" or "350F": the number big, its unit beside it smaller. Returns the height used.
static int uiDrawValue(const char *v, int y, uint16_t col) {
  const char *numSet = "0123456789-.,:%$+ \x7f";
  int split = 0;
  while (v[split] && strchr(numSet, v[split])) split++;
  char num[24], unit[24];
  // the number part runs up to the unit (and its trailing space)
  int end = split;
  while (end > 0 && v[end - 1] == ' ') end--;
  memcpy(num, v, end); num[end] = 0;
  strncpy(unit, v + split, sizeof(unit) - 1); unit[sizeof(unit) - 1] = 0;
  if (end == 0) {                                   // words only: one plain line
    const NeddyFont &f = uiTextWidth(NFONT_TITLE, v) <= 346 ? NFONT_TITLE : NFONT_BODY;
    uiTextCentered(f, y + (NFONT_TEMP.h - f.h) / 2, v, col);
    return NFONT_TEMP.h;
  }
  const NeddyFont *nf = &NFONT_TEMP;
  int gap = unit[0] ? (v[split - 1] == ' ' ? 10 : 3) : 0;   // a space in the text is a space on the screen
  int uw = unit[0] ? uiTextWidth(NFONT_TITLE, unit) : 0;
  if (uiTextWidth(*nf, num) + gap + uw > 346) nf = &NFONT_BIG;
  if (uiTextWidth(*nf, num) + gap + uw > 346) { uiTextCentered(NFONT_TITLE, y + (NFONT_TEMP.h - NFONT_TITLE.h) / 2, v, col); return NFONT_TEMP.h; }
  int total = uiTextWidth(*nf, num) + gap + uw;
  int x = (UI_W - total) / 2;
  int ny = y + (NFONT_TEMP.h - nf->h) / 2;
  uiText(*nf, x, ny, num, col);
  if (unit[0]) uiText(NFONT_TITLE, x + uiTextWidth(*nf, num) + gap, ny + nf->h - NFONT_TITLE.h - (nf == &NFONT_TEMP ? 14 : 6), unit, col);
  return NFONT_TEMP.h;
}

static void uiDrawFact() {
  uiCardHeader(uiCard.place);
  int start[2], len[2];
  int lines = uiCard.sub[0] ? uiWrap(NFONT_BODY, uiCard.sub, 340, start, len, 2) : 0;
  int groupH = NFONT_TEMP.h + (lines ? 10 + lines * 32 : 0) + (uiCard.note[0] ? 34 : 0);
  int y = 50 + (280 - groupH) / 2;
  uiDrawValue(uiCard.sky, y, UI_WHITE);
  y += NFONT_TEMP.h + 10;
  uint16_t tone = uiCard.tone == 1 ? UI_GREEN : (uiCard.tone == 2 ? UI_CORAL : UI_WHITE);
  char line[56];
  for (int i = 0; i < lines; i++) {
    int l = len[i] < 55 ? len[i] : 55;
    memcpy(line, uiCard.sub + start[i], l); line[l] = 0;
    uiTextCentered(NFONT_BODY, y, line, tone);
    y += 32;
  }
  if (uiCard.note[0]) uiTextCentered(NFONT_MID, y + 4, uiCard.note, UI_GREY);
}

static void uiDrawList() {
  const int PX = 14, PW = 382;
  const uint16_t border = uiRgb(52, 74, 88);
  uiCardHeader(uiCard.place);
  int n = uiCard.rows;
  if (n < 1) return;
  int rowH = n <= 4 ? 62 : 52;
  int top = 54 + (n <= 4 ? (262 - n * rowH) / 2 : 0);   // a short list sits in the middle of the card
  char buf[32];
  for (int i = 0; i < n; i++) {
    int ry = top + i * rowH;
    if (i) uiOut.fill(PX + 28, ry - 2, PW - 56, 2, border);
    int vw = uiCard.rowValue[i][0] ? uiTextWidth(NFONT_MID, uiCard.rowValue[i]) : 0;
    int y = ry + (rowH - NFONT_BODY.h) / 2;
    uiFit(buf, sizeof(buf), NFONT_BODY, uiCard.rowLabel[i], 342 - vw - (vw ? 12 : 0));
    uiText(NFONT_BODY, 34, y, buf, UI_WHITE);
    if (vw) uiText(NFONT_MID, 376 - vw, ry + (rowH - NFONT_MID.h) / 2, uiCard.rowValue[i], UI_AMBER);
  }
}

// ---- the menu: the PWR side button (or a swipe up from the bottom edge) opens big tiles; tap one. Tiles are 176 x 148 px.
enum { UI_MENU_ANIM = 1, UI_MENU_SCREEN_OFF = 2, UI_MENU_FACE = 3, UI_MENU_REC = 4 };
enum { UI_SET_ANIM = 1, UI_SET_FACE = 2 };
enum { UI_REC_START = 1, UI_REC_STOP = 2, UI_REC_OK = 3, UI_REC_RETRY = 4 };   // what the recording screens ask the sketch for
static int uiFpsLevel = 1;                       // animation speed: 0 saver, 1 normal, 2 smooth
static int uiFace = 0;                           // the watch face: 0 info (clock, weather, meeting), 1 analog, 2 neon digital
static const int uiMenuIds[] = { UI_MENU_REC, UI_MENU_FACE, UI_MENU_ANIM, UI_MENU_SCREEN_OFF };
static const int uiMenuN = 4;
static bool uiRecAvailable = false;              // the sketch found the recording storage: the Record tile does something
static char uiRecSub[28] = "Up to 1 h 40";       // the Record tile's small line (how long it can record, or that one is waiting to be sent)
static void uiMenuTileRect(int i, int *x, int *y) {
  const int W = 176, H = 148, GAP = 14, X0 = 22;
  int row = i / 2, col = i % 2;
  int rows = (uiMenuN + 1) / 2;
  int Y0 = rows == 1 ? 104 : 20;                 // a single row sits in the middle
  *x = X0 + col * (W + GAP); *y = Y0 + row * (H + GAP);
}
// Which tile a point is on, or -1.
static int uiMenuHit(int px, int py) {
  for (int i = 0; i < uiMenuN; i++) {
    int x, y; uiMenuTileRect(i, &x, &y);
    if (px >= x && px < x + 176 && py >= y && py < y + 148) return i;
  }
  return -1;
}
static const char *uiFaceName() { return uiFace == 1 ? "Analog" : uiFace == 2 ? "Neon" : "Info"; }
static const char *uiFpsName() { return uiFpsLevel == 0 ? "Saver" : uiFpsLevel == 2 ? "Smooth" : "Normal"; }
// A ring made of even-aligned spans (the screen wants even windows).
static void uiRing(int cx, int cy, int r, int t, uint16_t col) {
  for (int dy = -r; dy < r; dy += 2) {
    float o = sqrtf((float)(r * r - dy * dy)), in = (r - t) > 0 && dy > -(r - t) && dy < (r - t) ? sqrtf((float)((r - t) * (r - t) - dy * dy)) : 0.0f;
    int xo = (int)o, xi = (int)in;
    int xl = (cx - xo) & ~1;
    if (xi <= 0) { uiOut.fill(xl, (cy + dy) & ~1, (2 * xo) & ~1, 2, col); }
    else {
      uiOut.fill(xl, (cy + dy) & ~1, (xo - xi) & ~1, 2, col);
      uiOut.fill((cx + xi) & ~1, (cy + dy) & ~1, (xo - xi) & ~1, 2, col);
    }
  }
}
static void uiDrawMenu() {
  const uint16_t panel = uiRgb(20, 28, 36), border = uiRgb(52, 74, 88), lit = UI_TEAL;
  for (int i = 0; i < uiMenuN; i++) {
    int x, y; uiMenuTileRect(i, &x, &y);
    uiRoundPanel(x, y, 176, 148, 22, border, panel);
    uiBg = panel;
    const char *label = "", *sub = "";
    int cx = x + 88;
    if (uiMenuIds[i] == UI_MENU_REC) {
      label = "Record"; sub = uiRecAvailable ? uiRecSub : "Not available";
      uint16_t red = uiRecAvailable ? uiRgb(255, 84, 72) : UI_DIM;          // a microphone: a rounded body, a cup, a stem
      uiOut.fill((cx - 10) & ~1, y + 18, 20, 30, red); uiOut.fill((cx - 6) & ~1, y + 20, 12, 26, panel);
      uiOut.fill((cx - 18) & ~1, y + 34, 4, 12, red); uiOut.fill((cx + 14) & ~1, y + 34, 4, 12, red); uiOut.fill((cx - 14) & ~1, y + 46, 28, 4, red);
      uiOut.fill((cx - 2) & ~1, y + 50, 4, 10, red); uiOut.fill((cx - 10) & ~1, y + 58, 20, 4, red);
    } else if (uiMenuIds[i] == UI_MENU_FACE) {
      label = "Watch face"; sub = uiFaceName();
      uiRing(cx, y + 44, 22, 4, lit);                // a little clock: a ring and two hands
      uiOut.fill(cx - 2, y + 28, 4, 18, lit);
      uiOut.fill(cx - 2, y + 42, 14, 4, lit);
    } else if (uiMenuIds[i] == UI_MENU_ANIM) {
      label = "Animation"; sub = uiFpsName();
      for (int b = 0; b < 3; b++) {                // three bars; the more are lit, the smoother
        int bh = 16 + b * 14, bx = (cx - 30 + b * 22) & ~1;
        uiOut.fill(bx, (y + 66 - bh) & ~1, 16, bh & ~1, b <= uiFpsLevel ? lit : UI_DIM);
      }
    } else {
      label = "Screen off"; sub = "Tap to wake";
      uiRing(cx, y + 44, 22, 4, lit);              // a power ring with a notch and a stroke
      uiOut.fill(cx - 8, y + 20, 16, 14, panel);
      uiOut.fill(cx - 2, y + 18, 4, 26, lit);
    }
    uiText(NFONT_BODY, (cx - uiTextWidth(NFONT_BODY, label) / 2) & ~1, y + 76, label, UI_WHITE);
    uiText(NFONT_SMALL, (cx - uiTextWidth(NFONT_SMALL, sub) / 2) & ~1, y + 76 + NFONT_BODY.h + 2, sub, UI_GREY);
    uiBg = UI_BLACK;
  }
}
static void uiDrawCard() {
  const int PX = 14, PY = 10, PW = 382, PH = 336;
  if (uiCard.kind == UI_CARD_MENU) { uiDrawMenu(); return; }
  if (uiCard.kind == UI_CARD_WEATHER) { uiDrawWeather(); return; }
  const uint16_t panel = uiRgb(20, 28, 36), border = uiRgb(52, 74, 88);
  uiRoundPanel(PX, PY, PW, PH, 24, border, panel);
  uiBg = panel;
  if (uiCard.kind == UI_CARD_SCORE) uiDrawScore();
  else if (uiCard.kind == UI_CARD_FACT) uiDrawFact();
  else uiDrawList();
  uiBg = UI_BLACK;
}

// The last few cards are remembered, so a swipe can bring one back.
static void uiRemember() {
  if (uiHistN == UI_HIST) { for (int i = 1; i < UI_HIST; i++) uiHist[i - 1] = uiHist[i]; uiHistN--; }
  uiHist[uiHistN] = uiCard;
  uiHistAt = uiHistN;
  uiHistN++;
}
static void uiShowFromHistory(uint32_t ms, int i) {
  uiCard = uiHist[i];
  uiCard.on = true; uiCard.since = ms;
  uiHistAt = i; uiAll = true;
}
// Swipe right: the one before (or, with no card up, the last one). Swipe left: the one after.
static void uiCardBack(uint32_t ms) {
  if (!uiHistN) return;
  if (!uiCard.on) uiShowFromHistory(ms, uiHistAt >= 0 && uiHistAt < uiHistN ? uiHistAt : uiHistN - 1);
  else if (uiHistAt > 0) uiShowFromHistory(ms, uiHistAt - 1);
}
static void uiCardForward(uint32_t ms) {
  if (uiCard.on && uiHistAt >= 0 && uiHistAt < uiHistN - 1) uiShowFromHistory(ms, uiHistAt + 1);
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
  uiCard.kind = UI_CARD_WEATHER;
  uiActivity(ms);
  uiCard.since = ms; uiCard.on = true; uiAll = true;
  uiRemember();
}

static void uiStartCard(uint32_t ms, int kind) { uiActivity(ms); memset(&uiCard, 0, sizeof(uiCard)); uiCard.kind = kind; uiCard.since = ms; uiCard.on = true; uiAll = true; }
static void uiMenuOpen(uint32_t ms) {
  if (uiCard.on && uiCard.kind == UI_CARD_MENU) { uiClearCard(); return; }   // the button again closes it
  uiStartCard(ms, UI_CARD_MENU);
}
static void uiMenuTap(uint32_t ms, int px, int py) {
  uiCard.since = ms;
  int i = uiMenuHit(px, py);
  if (i < 0) { uiClearCard(); return; }
  if (uiMenuIds[i] == UI_MENU_REC) {
    uiClearCard();
    if (uiRecAvailable && uiOut.record) uiOut.record(UI_REC_START);
  } else if (uiMenuIds[i] == UI_MENU_FACE) {
    uiFace = (uiFace + 1) % 3;
    if (uiOut.setting) uiOut.setting(UI_SET_FACE, uiFace);
    uiClearCard();                                                  // close the menu and show the new face at once (not after ten quiet seconds)
    if (uiIdle.have && uiIdle.after > 0 && uiMode == UI_READY) {
      uiIdleOn = true; uiIdleSince = ms; uiDimmed = false; uiIdleMinute = -1; uiWords[0] = 0; uiHeard[0] = 0;
    }
    uiAll = true;
  } else if (uiMenuIds[i] == UI_MENU_ANIM) {
    uiFpsLevel = (uiFpsLevel + 1) % 3;
    if (uiOut.setting) uiOut.setting(UI_SET_ANIM, uiFpsLevel);
    uiAll = true;
  } else if (uiMenuIds[i] == UI_MENU_SCREEN_OFF) {
    uiClearCard();
    uiScreenOff = true;                          // dark, and nothing is drawn (saves battery); any touch, press or words wake it
    if (uiOut.brightness) uiOut.brightness(0);
  }
}

// A game. Scores the server didn't send are UI_NONE (a game still to come).
static void uiShowScore(uint32_t ms, const char *league, const char *status, const char *away, int awayScore, const char *home, int homeScore) {
  uiStartCard(ms, UI_CARD_SCORE);
  uiCopyTrim(uiCard.league, sizeof(uiCard.league), league);
  uiCopyTrim(uiCard.status, sizeof(uiCard.status), status);
  uiCopyTrim(uiCard.away, sizeof(uiCard.away), away);
  uiCopyTrim(uiCard.home, sizeof(uiCard.home), home);
  uiCard.awayScore = awayScore; uiCard.homeScore = homeScore;
  uiRemember();
}
// One headline value. tone: 0 plain, 1 good (green), 2 bad (red).
static void uiShowFact(uint32_t ms, const char *label, const char *value, const char *sub, const char *note, int tone) {
  uiStartCard(ms, UI_CARD_FACT);
  uiCopyTrim(uiCard.place, sizeof(uiCard.place), label);
  uiCopyTrim(uiCard.sky, sizeof(uiCard.sky), value);
  uiCopyTrim(uiCard.sub, sizeof(uiCard.sub), sub);
  uiCopyTrim(uiCard.note, sizeof(uiCard.note), note);
  uiCard.tone = tone;
  uiRemember();
}
// Up to five rows.
static void uiShowList(uint32_t ms, const char *title, int n, const char **labels, const char **values) {
  uiStartCard(ms, UI_CARD_LIST);
  uiCopyTrim(uiCard.place, sizeof(uiCard.place), title);
  uiCard.rows = n < 0 ? 0 : (n > 5 ? 5 : n);
  for (int i = 0; i < uiCard.rows; i++) {
    uiCopyTrim(uiCard.rowLabel[i], sizeof(uiCard.rowLabel[i]), labels[i]);
    uiCopyTrim(uiCard.rowValue[i], sizeof(uiCard.rowValue[i]), values[i]);
  }
  uiRemember();
}

// ---- touch gestures. The sketch reads the touch chip and calls uiTouch about every 16 ms.
//   tap Neddy: he giggles. Finger on Neddy: his eyes follow it. Hold Neddy (about half a second): talk while held.
//   Double-tap Neddy: talk hands-free until the next touch. Tap a card: it goes away. Swipe: earlier / later cards.
#define UI_HOLD_MS 450
#define UI_TAP_MS 450
#define UI_DOUBLE_MS 380
#define UI_SLOP 30
#define UI_SWIPE 60
static bool uiTchWas = false, uiTchHold = false, uiTchLatched = false, uiTchIgnore = false, uiTchOnNeddy = false;
// ---- the recording screens. While recording the whole screen is the recorder: a red REC mark, the time, how much room is left, a big Stop.
// After Stop (and in the sketch's other messages) an info screen shows what is happening to the recording. The sketch drives it.
enum { UI_RECS_OFF, UI_RECS_RUN, UI_RECS_INFO };
struct UiRec {
  int state;
  bool full, dirty, dimmed, ignoreTouch;
  uint32_t elapsed, left; int usedPct;
  char title[40], big[24], small[48], button[16];
  int pct;                                       // a progress bar (0..100), -1 for none
  uint32_t lastTouch;
};
static UiRec uiRec;
#define UI_REC_DIM_MS 20000
static void uiRecRun(uint32_t ms, uint32_t elapsed, uint32_t left, int usedPct) {
  if (uiRec.state != UI_RECS_RUN) { memset(&uiRec, 0, sizeof(uiRec)); uiRec.state = UI_RECS_RUN; uiRec.full = true; uiRec.lastTouch = ms; }
  if (uiRec.elapsed != elapsed || uiRec.left != left || uiRec.usedPct != usedPct) uiRec.dirty = true;
  uiRec.elapsed = elapsed; uiRec.left = left; uiRec.usedPct = usedPct;
}
static void uiRecInfo(uint32_t ms, const char *title, const char *big, const char *small, int pct, const char *button) {
  if (uiRec.state != UI_RECS_INFO) { bool was = uiRec.dimmed; memset(&uiRec, 0, sizeof(uiRec)); uiRec.state = UI_RECS_INFO; uiRec.dimmed = was; }
  uiRec.full = true; uiRec.lastTouch = ms; uiRec.pct = pct;
  uiCopyTrim(uiRec.title, sizeof(uiRec.title), title); uiCopyTrim(uiRec.big, sizeof(uiRec.big), big);
  uiCopyTrim(uiRec.small, sizeof(uiRec.small), small); uiCopyTrim(uiRec.button, sizeof(uiRec.button), button);
}
static void uiRecEnd() {
  if (uiRec.state == UI_RECS_OFF) return;
  if (uiRec.dimmed && uiOut.brightness) uiOut.brightness(255);
  memset(&uiRec, 0, sizeof(uiRec)); uiAll = true;
}
static void uiRecBar(int y, int pct, uint16_t col) {
  uiRoundPanel(60, y, 290, 22, 10, uiRgb(52, 74, 88), UI_BLACK);
  int w = ((286 * (pct < 0 ? 0 : pct > 100 ? 100 : pct)) / 100) & ~1;
  if (w >= 12) uiOut.fill(62, y + 2, w, 18, col);
}
static void uiRecTime(char *dst, size_t cap, uint32_t seconds) {
  snprintf(dst, cap, "%02u:%02u:%02u", (unsigned)(seconds / 3600), (unsigned)((seconds / 60) % 60), (unsigned)(seconds % 60));
}
static void uiRecDraw() {
  const uint16_t red = uiRgb(255, 84, 72), dark = uiRgb(60, 24, 24), teal = UI_TEAL;
  if (uiRec.state == UI_RECS_RUN) {
    if (uiRec.full) {
      uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
      uiText(NFONT_MID, 70, 22, "REC", red);
      uiRoundPanel(96, 340, 218, 100, 26, red, dark);
      uiBg = dark; uiTextCentered(NFONT_TITLE, 340 + (100 - NFONT_TITLE.h) / 2, "Stop", UI_WHITE); uiBg = UI_BLACK;
      uiTextCentered(NFONT_SMALL, 462, "Tap Stop, or press the PWR button", UI_DIM);
    }
    uiRing(42, 36, 14, 14, (uiRec.elapsed & 1) ? uiRgb(120, 40, 36) : red);          // the mark blinks each second
    char t[16]; uiRecTime(t, sizeof(t), uiRec.elapsed);
    const NeddyFont &f = uiTextWidth(NFONT_TEMP, t) <= 380 ? NFONT_TEMP : NFONT_BIG;
    uiOut.fill(0, 96, UI_W, 110, UI_BLACK);
    uiTextCentered(f, 100 + (100 - f.h) / 2, t, UI_WHITE);
    char left[40];
    uint32_t m = uiRec.left / 60;
    if (m >= 60) snprintf(left, sizeof(left), "%u h %u min left on the watch", (unsigned)(m / 60), (unsigned)(m % 60));
    else snprintf(left, sizeof(left), "%u min left on the watch", (unsigned)m);
    uiOut.fill(0, 226, UI_W, 36, UI_BLACK);
    uiTextCentered(NFONT_BODY, 226, left, UI_GREY);
    uiRecBar(282, uiRec.usedPct, uiRec.usedPct >= 85 ? UI_AMBER : teal);
  } else if (uiRec.state == UI_RECS_INFO) {
    uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
    uiTextCentered(NFONT_MID, 70, uiRec.title, UI_WHITE);
    if (uiRec.big[0]) uiTextCentered(NFONT_BIG, 140, uiRec.big, teal);
    char fit[48]; uiFit(fit, sizeof(fit), NFONT_BODY, uiRec.small, 360);
    uiTextCentered(NFONT_BODY, 250, fit, UI_GREY);
    if (uiRec.pct >= 0) uiRecBar(318, uiRec.pct, teal);
    if (uiRec.button[0]) {
      uiRoundPanel(96, 380, 218, 90, 26, uiRgb(52, 74, 88), uiRgb(20, 28, 36));
      uiBg = uiRgb(20, 28, 36); uiTextCentered(NFONT_MID, 380 + (90 - NFONT_MID.h) / 2, uiRec.button, UI_WHITE); uiBg = UI_BLACK;
    }
  }
  uiRec.full = false; uiRec.dirty = false;
}
// ---- Wi-Fi setup screens. The sketch decides the stage (nothing here touches the radio). The first shows a QR code that makes a phone join
// the watch's own temporary Wi-Fi; the second shows a QR code for the page where the person picks their home Wi-Fi.
enum { UI_SETUP_JOIN = 1, UI_SETUP_PAGE, UI_SETUP_TRYING, UI_SETUP_DONE, UI_SETUP_FAIL };
static QrCode uiQr;
// A QR code on a white card (readers need the white border all round), `scale` screen dots to a code dot, centred, top edge at y.
// Returns the bottom edge of the card.
static int uiDrawQr(const char *text, int y, int scale) {
  if (!qrEncode(uiQr, text)) return y;
  const int quiet = 4, side = (uiQr.size + 2 * quiet) * scale, x0 = ((UI_W - side) / 2) & ~1;
  y &= ~1;
  uiOut.fill(x0, y, side, side, 0xFFFF);
  for (int my = 0; my < uiQr.size; my++) {
    int mx = 0;
    while (mx < uiQr.size) {
      if (!qrGet(uiQr, mx, my)) { mx++; continue; }
      int run = mx;
      while (run < uiQr.size && qrGet(uiQr, run, my)) run++;
      uiOut.fill(x0 + (quiet + mx) * scale, y + (quiet + my) * scale, (run - mx) * scale, scale, 0);
      mx = run;
    }
  }
  return y + side;
}
static void uiSetupScreen(int stage, const char *ssid, const char *qrText, const char *url) {
  uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
  uiBg = UI_BLACK;
  char fit[48];
  uiFit(fit, sizeof(fit), NFONT_BODY, ssid ? ssid : "", 360);
  if (stage == UI_SETUP_JOIN) {
    uiTextCentered(NFONT_TITLE, 16, "Set up Wi-Fi", UI_WHITE);
    int b = uiDrawQr(qrText, 74, 8);
    uiTextCentered(NFONT_BODY, b + 12, "Scan with your camera", UI_TEAL);
    uiFit(fit, sizeof(fit), NFONT_SMALL, ssid ? ssid : "", 340);
    uiTextCentered(NFONT_SMALL, b + 56, fit, UI_GREY);
  } else if (stage == UI_SETUP_PAGE) {
    uiTextCentered(NFONT_TITLE, 16, "Choose your Wi-Fi", UI_WHITE);
    int b = uiDrawQr(qrText, 74, 8);
    uiTextCentered(NFONT_MID, b + 10, "Page didn't open by itself?", UI_GREY);
    uiTextCentered(NFONT_MID, b + 40, "Scan this, or go to", UI_GREY);
    uiTextCentered(NFONT_BODY, b + 72, url ? url : "", UI_TEAL);
  } else if (stage == UI_SETUP_TRYING) {
    uiTextCentered(NFONT_TITLE, 150, "Connecting...", UI_WHITE);
    uiTextCentered(NFONT_BODY, 220, fit, UI_TEAL);
    uiTextCentered(NFONT_MID, 280, "This takes a few seconds", UI_GREY);
  } else if (stage == UI_SETUP_DONE) {
    uiTextCentered(NFONT_TITLE, 150, "Wi-Fi is set up", UI_TEAL);
    uiTextCentered(NFONT_BODY, 220, fit, UI_WHITE);
  } else {
    uiTextCentered(NFONT_TITLE, 130, "Couldn't connect", UI_AMBER);
    uiTextCentered(NFONT_BODY, 200, "Check the password", UI_WHITE);
    uiTextCentered(NFONT_MID, 250, "and try again on your phone", UI_GREY);
  }
}

// A finger on a recording screen: any touch wakes it; a tap on the big button does what it says.
static void uiRecTouch(uint32_t ms, bool down, int x, int y) {
  static bool was = false; static int x0 = 0, y0 = 0, lx = 0, ly = 0; static uint32_t at = 0;
  if (down) { lx = x; ly = y; }                                     // a lifted finger has no position: use where it last was
  if (down && !was) {
    x0 = x; y0 = y; at = ms; uiRec.lastTouch = ms;
    uiRec.ignoreTouch = uiRec.dimmed;                               // the touch that wakes the screen only wakes it
    if (uiRec.dimmed) { uiRec.dimmed = false; if (uiOut.brightness) uiOut.brightness(255); }
  } else if (!down && was) {
    int dx = lx - x0, dy = ly - y0; if (dx < 0) dx = -dx; if (dy < 0) dy = -dy;
    if (!uiRec.ignoreTouch && dx < UI_SLOP && dy < UI_SLOP && ms - at < UI_TAP_MS && uiOut.record) {
      if (uiRec.state == UI_RECS_RUN && x0 >= 72 && x0 < 338 && y0 >= 324 && y0 < 456) uiOut.record(UI_REC_STOP);
      else if (uiRec.state == UI_RECS_INFO && uiRec.button[0] && x0 >= 72 && x0 < 338 && y0 >= 364 && y0 < 486) uiOut.record(UI_REC_OK);
    }
  }
  if (down) uiRec.lastTouch = ms;
  was = down;
}

static uint32_t uiTchDownAt = 0, uiTchLastTap = 0;
static int uiTchX0 = 0, uiTchY0 = 0, uiTchX = 0, uiTchY = 0, uiTchMove = 0;

// On this screen 1 mm is about 12 pixels, and a fingertip is about 9 mm wide: anything to touch is at least ~100 px
// across, and Neddy's touch area reaches 32 px past his picture on every side (so small Neddy is ~180 x 210 px).
#define UI_HIT_MARGIN 32
static bool uiHitNeddy(int x, int y) {
  return x >= uiStageX - UI_HIT_MARGIN && x < uiStageX + uiStageW + UI_HIT_MARGIN && y >= uiStageY - UI_HIT_MARGIN && y < uiStageY + uiStageH + UI_HIT_MARGIN;
}
static bool uiHitCard(int x, int y) { return uiCard.on && x >= 14 && x < 396 && y >= 10 && y < 346; }
static void uiReact(uint32_t ms) { uiReactUntil = ms + 1000; }
static void uiLook(uint32_t ms, int x, int y) { uiLookX = x; uiLookY = y; uiLookUntil = ms + 600; }
// The sketch calls this when talking ended (the button, the time limit), so a hold or hands-free talk lets go.
static void uiTouchTalkEnded() { uiTouchTalk = false; uiTchLatched = false; }

static void uiTouch(uint32_t ms, bool down, int x, int y) {
  if (uiRec.state != UI_RECS_OFF) { uiRecTouch(ms, down, x, y); return; }
  if (down) { uiActivity(ms); if (uiCard.on && uiCard.kind == UI_CARD_MENU) uiCard.since = ms; }
  if (down && !uiTchWas) {                           // a finger just touched
    uiTchDownAt = ms; uiTchX0 = uiTchX = x; uiTchY0 = uiTchY = y; uiTchMove = 0;
    uiTchHold = false; uiTchIgnore = false;
    uiTchOnNeddy = uiHitNeddy(x, y) && !uiHitCard(x, y);
    if (uiTchLatched) {                              // any touch ends hands-free talking
      uiTchLatched = false; uiTouchTalk = false; uiTchIgnore = true;
    }
  } else if (down) {                                 // still touching
    uiTchX = x; uiTchY = y;
    int mx = x > uiTchX0 ? x - uiTchX0 : uiTchX0 - x, my = y > uiTchY0 ? y - uiTchY0 : uiTchY0 - y;
    int m = mx > my ? mx : my;
    if (m > uiTchMove) uiTchMove = m;
    if (uiTchOnNeddy && !uiTchIgnore && !uiTchHold && uiMode != UI_LISTEN) uiLook(ms, x, y);
    if (uiTchOnNeddy && !uiTchIgnore && !uiTchHold && uiTchMove < UI_SLOP && ms - uiTchDownAt >= UI_HOLD_MS) {
      uiTchHold = true; uiTouchTalk = true;          // holding Neddy = holding the button
    }
  } else if (uiTchWas) {                             // the finger lifted
    uint32_t held = ms - uiTchDownAt;
    if (uiTchHold) { uiTchHold = false; uiTouchTalk = false; }
    else if (!uiTchIgnore) {
      int dx = uiTchX - uiTchX0, dy = uiTchY - uiTchY0;
      int adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
      if (adx >= UI_SWIPE && adx * 2 > ady * 3 && held < 800) {
        if (uiCard.on && uiCard.kind == UI_CARD_MENU) { /* the menu isn't a card to flip through */ }
        else if (dx > 0) uiCardBack(ms); else uiCardForward(ms);
      } else if (dy < 0 && ady >= 90 && ady * 2 > adx * 3 && uiTchY0 >= 420 && held < 900) {
        uiMenuOpen(ms);                            // a swipe up from the bottom edge opens the menu
      } else if (uiTchMove < UI_SLOP && held < UI_TAP_MS) {
        if (uiCard.on && uiCard.kind == UI_CARD_MENU) { uiMenuTap(ms, uiTchX0, uiTchY0); uiTchLastTap = 0; }
        else if (uiHitCard(uiTchX0, uiTchY0)) { uiClearCard(); uiTchLastTap = 0; }
        else if (uiTchOnNeddy) {
          if (uiTchLastTap && ms - uiTchLastTap < UI_DOUBLE_MS) { uiTchLatched = true; uiTouchTalk = true; uiTchLastTap = 0; }
          else { uiReact(ms); uiTchLastTap = ms; }
        }
      }
    }
  }
  uiTchWas = down;
}

static void uiTextAreas(int *top, int *bottom);
// ---- the idle face
static int64_t uiUtcNow(uint32_t ms) { return (int64_t)uiIdle.baseUtc + (int64_t)((uint32_t)(ms - uiIdle.baseMs) / 1000); }
// Splits seconds-since-1970 (already in the person's clock) into date and time.
static void uiCivil(int64_t local, int *year, int *month, int *day, int *hour, int *minute, int *weekday) {
  int64_t days = local / 86400; int64_t rem = local % 86400;
  if (rem < 0) { rem += 86400; days -= 1; }
  *hour = (int)(rem / 3600); *minute = (int)((rem % 3600) / 60);
  *weekday = (int)(((days % 7) + 11) % 7);            // 1970-01-01 was a Thursday
  int64_t z = days + 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  int64_t doe = z - era * 146097;
  int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t y = yoe + era * 400;
  int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int64_t mp = (5 * doy + 2) / 153;
  *day = (int)(doy - (153 * mp + 2) / 5 + 1);
  *month = (int)(mp < 10 ? mp + 3 : mp - 9);
  *year = (int)(y + (*month <= 2));
}
static const char *uiDays[7] = { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };
static const char *uiMonths[12] = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
// "2:41" and "PM" for an hour and minute.
static void uiClockText(char *time, char *ampm, int hour, int minute) {
  int h = hour % 12; if (h == 0) h = 12;
  snprintf(time, 8, "%d:%02d", h, minute);
  strcpy(ampm, hour < 12 ? "AM" : "PM");
}

// The weather picture at a smaller size (the same shapes as the card's).
static void uiRenderIconSmall(int icon, uint16_t bg, int size) {
  const float br = ((bg >> 11) & 31) * 255.0f / 31, bgc = ((bg >> 5) & 63) * 255.0f / 63, bb = (bg & 31) * 255.0f / 31;
  const float k = (float)UI_ICON / size;
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      float c[3] = { br, bgc, bb };
      uiIconPixel(icon, (x + 0.5f) * k, (y + 0.5f) * k, c);
      int r = (int)(c[0] + 0.5f), g = (int)(c[1] + 0.5f), b = (int)(c[2] + 0.5f);
      if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      uiIconBuf[y * size + x] = uiRgb(r, g, b);
    }
  }
}

// The battery, big enough to read at a glance: an outline with its fill, the percent in a readable size, a bolt and the word "charging"
// while it charges. When the chip can't be read it says so (with the two raw status bytes), never nothing.
static void uiDrawBolt(int cx, int cy, uint16_t col) {          // a lightning bolt, 20 high, from rows two dots tall
  static const int8_t bx[10] = { 4, 2, 0, -2, -6, 2, 0, -2, -4, -6 };
  static const int8_t bw[10] = { 8, 8, 8, 8, 16, 8, 8, 6, 4, 2 };
  for (int i = 0; i < 10; i++) uiOut.fill((cx + bx[i]) & ~1, (cy - 10 + i * 2) & ~1, bw[i], 2, col);
}
static void uiDrawBatteryAt(int y) {
  if (!uiIdle.showB) return;
  y &= ~1;
  const int bw = 64, bh = 32;
  const bool known = uiIdle.bat >= 0;
  const int pct = uiIdle.bat > 100 ? 100 : (uiIdle.bat < 0 ? 0 : uiIdle.bat);
  char t[40];
  if (!known) {                                                  // no battery reading: say so plainly, with no empty battery drawn
    snprintf(t, sizeof(t), uiIdle.vbus ? "Plugged in, no battery" : "No battery");
    uiText(NFONT_MID, ((UI_W - uiTextWidth(NFONT_MID, t)) / 2) & ~1, y + (bh - NFONT_MID.h) / 2, t, UI_GREY);
    return;
  }
  if (known) {
    if (uiIdle.chg) snprintf(t, sizeof(t), "%d%% charging", pct);
    else if (uiIdle.vbus) snprintf(t, sizeof(t), "%d%% plugged in", pct);
    else snprintf(t, sizeof(t), "%d%%", pct);
    if (uiTextWidth(NFONT_MID, t) + bw + 22 > 370) snprintf(t, sizeof(t), "%d%%", pct);
  } else {
    snprintf(t, sizeof(t), "No battery %02x %02x", uiBatRaw[0], uiBatRaw[1]);
  }
  const uint16_t green = uiRgb(96, 214, 140), red = uiRgb(255, 84, 72);
  uint16_t col = uiIdle.chg ? UI_TEAL : (pct <= 15 ? red : (pct <= 30 ? UI_AMBER : green));
  if (!known) col = UI_DIM;
  int tw = uiTextWidth(NFONT_MID, t);
  int x = ((UI_W - (bw + 4 + 14 + tw)) / 2) & ~1;
  uiOut.fill(x, y, bw, bh, known ? UI_WHITE : UI_DIM);                       // the outline
  uiOut.fill(x + 4, y + 4, bw - 8, bh - 8, UI_BLACK);
  uiOut.fill(x + bw, y + 10, 4, 12, known ? UI_WHITE : UI_DIM);              // the little knob on the end
  int fw = (((bw - 12) * pct) / 100) & ~1;
  if (known && fw < 2 && pct > 0) fw = 2;
  if (known && fw > 0) uiOut.fill(x + 6, y + 6, fw, bh - 12, col);
  if (known && uiIdle.chg) uiDrawBolt(x + bw / 2, y + bh / 2, pct >= 50 ? UI_BLACK : UI_WHITE);
  if (!known) uiText(NFONT_MID, x + bw / 2 - 6, y + 2, "?", UI_DIM);
  uiText(NFONT_MID, x + bw + 4 + 14, y + (bh - NFONT_MID.h) / 2, t, (uiIdle.chg || pct <= 30 || !known) ? col : UI_WHITE);
}

static void uiDrawBattery(int bottom) { uiDrawBatteryAt(bottom - 34); }

// A thick line made of even-aligned squares (the screen wants even windows).
static void uiThickLine(float x0, float y0, float x1, float y1, int th, uint16_t col) {
  float dx = x1 - x0, dy = y1 - y0, len = sqrtf(dx * dx + dy * dy);
  int n = (int)(len / 2.0f) + 1;
  for (int i = 0; i <= n; i++) {
    float t = (float)i / n;
    int x = (int)(x0 + dx * t - th * 0.5f) & ~1, y = (int)(y0 + dy * t - th * 0.5f) & ~1;
    uiOut.fill(x, y, th, th, col);
  }
}

// Face 1: an analog dial. Hands and ticks only: it is redrawn once a minute.
static void uiDrawAnalog(int top, int bottom, int h, int mi, int wd, int Mo, int D, int dx, int dy) {
  float R = (bottom - top) * 0.5f - 6.0f;
  if (R > 190.0f) R = 190.0f;
  float cx = UI_W * 0.5f + dx, cy = top + (bottom - top) * 0.5f + dy;
  for (int i = 0; i < 60; i++) {
    float a = (i * 6 - 90) * 0.0174533f, ca = cosf(a), sa = sinf(a);
    bool big = i % 5 == 0;
    float r1 = R - (big ? 20.0f : 8.0f), r2 = R - 2.0f;
    uiThickLine(cx + r1 * ca, cy + r1 * sa, cx + r2 * ca, cy + r2 * sa, big ? 6 : 2, big ? UI_WHITE : uiRgb(86, 92, 98));
  }
  uiText(NFONT_SMALL, ((int)cx - uiTextWidth(NFONT_SMALL, "NEDDY") / 2) & ~1, (int)(cy - R * 0.42f) & ~1, "NEDDY", UI_GREY);
  char dl[16]; snprintf(dl, sizeof(dl), "%.3s %d", uiDays[wd], D);          // the date window, under the middle
  int dw = uiTextWidth(NFONT_SMALL, dl);
  int wx = ((int)cx - dw / 2) & ~1, wy = ((int)(cy + R * 0.30f)) & ~1;
  uiRoundPanel(wx - 10, wy - 4, (dw + 20) & ~1, 30, 6, uiRgb(70, 76, 82), UI_BLACK);
  uiText(NFONT_SMALL, wx, wy, dl, UI_WHITE);
  float ah = ((h % 12) + mi / 60.0f) * 30.0f - 90.0f, am = mi * 6.0f - 90.0f;
  uiThickLine(cx, cy, cx + R * 0.52f * cosf(ah * 0.0174533f), cy + R * 0.52f * sinf(ah * 0.0174533f), 10, UI_WHITE);
  uiThickLine(cx, cy, cx + R * 0.80f * cosf(am * 0.0174533f), cy + R * 0.80f * sinf(am * 0.0174533f), 6, UI_WHITE);
  uiOut.fill(((int)cx - 8) & ~1, ((int)cy - 8) & ~1, 16, 16, uiRgb(255, 120, 40));
  uiDrawBatteryAt((int)(cy + R * 0.50f));
}

// Face 2: neon digits, seven glowing segments each; the unlit ones stay faintly visible.
static void uiNeonDigit(int x, int y, int d, uint16_t on, uint16_t off) {
  static const uint8_t seg[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };   // a b c d e f g in bits 0..6
  const int w = 64, hgt = 128, t = 12;
  const int r[7][4] = { { t, 0, w - 2 * t, t }, { w - t, t, t, hgt / 2 - t - t / 2 }, { w - t, hgt / 2 + t / 2, t, hgt / 2 - t - t / 2 }, { t, hgt - t, w - 2 * t, t },
                        { 0, hgt / 2 + t / 2, t, hgt / 2 - t - t / 2 }, { 0, t, t, hgt / 2 - t - t / 2 }, { t, hgt / 2 - t / 2, w - 2 * t, t } };
  for (int i = 0; i < 7; i++) uiOut.fill((x + r[i][0]) & ~1, (y + r[i][1]) & ~1, r[i][2] & ~1, r[i][3] & ~1, (d >= 0 && (seg[d] >> i) & 1) ? on : off);
}
static void uiDrawNeon(int top, int h, int mi, int wd, int Mo, int D, int dx, int dy) {
  const uint16_t on = uiRgb(255, 150, 40), off = uiRgb(44, 26, 12);
  int h12 = h % 12 == 0 ? 12 : h % 12;
  int x0 = (46 + dx) & ~1, y0 = (top + 56 + dy) & ~1;
  uiNeonDigit(x0, y0, h12 >= 10 ? h12 / 10 : -1, on, off);
  uiNeonDigit(x0 + 76, y0, h12 % 10, on, off);
  uiOut.fill(x0 + 76 + 64 + 6, y0 + 36, 14, 14, on); uiOut.fill(x0 + 76 + 64 + 6, y0 + 78, 14, 14, on);
  uiNeonDigit(x0 + 178, y0, mi / 10, on, off);
  uiNeonDigit(x0 + 254, y0, mi % 10, on, off);
  char ap[4]; snprintf(ap, sizeof(ap), "%s", h >= 12 ? "PM" : "AM");
  uiText(NFONT_TITLE, (x0 + 254 + 64 - uiTextWidth(NFONT_TITLE, ap)) & ~1, y0 + 128 + 10, ap, UI_GREY);
  char line[40]; snprintf(line, sizeof(line), "%s, %s %d", uiDays[wd], uiMonths[Mo - 1], D);
  uiTextCentered(NFONT_BODY, y0 + 128 + 14, line, UI_GREY);
  if (uiIdle.showW && uiIdle.haveW) {
    char tp[40]; snprintf(tp, sizeof(tp), "%d%c  %s", uiIdle.wt, (char)127, uiIdle.ws);
    char fit[40]; uiFit(fit, sizeof(fit), NFONT_SMALL, tp, 340);
    uiTextCentered(NFONT_SMALL, y0 + 128 + 14 + NFONT_BODY.h + 12, fit, UI_DIM);
  }
}

// The whole idle face above Neddy. The clock drifts a few pixels now and then so no pixel stays lit (the screen is AMOLED).
static void uiDrawIdle(uint32_t ms) {
  int top, bottom;
  uiTextAreas(&top, &bottom);
  uiOut.fill(0, top, UI_W, bottom - top, UI_BLACK);
  int64_t local = uiUtcNow(ms) + (int64_t)uiIdle.off * 60;
  int Y, Mo, D, h, mi, wd;
  uiCivil(local, &Y, &Mo, &D, &h, &mi, &wd);
  uiIdleMinute = (int)(local / 60);
  int dx = (((int)(local / 300)) % 5 - 2) * 2, dy = (((int)(local / 420)) % 3 - 1) * 2;
  if (uiFace == 1) { uiDrawAnalog(top, bottom, h, mi, wd, Mo, D, dx, dy); return; }
  if (uiFace == 2) { uiDrawNeon(top, h, mi, wd, Mo, D, dx, dy); uiDrawBattery(bottom); return; }
  char tm[10], ap[4], line[48];
  uiClockText(tm, ap, h, mi);
  int tw = uiTextWidth(NFONT_TEMP, tm), aw = uiTextWidth(NFONT_TITLE, ap);
  int x = (UI_W - (tw + 8 + aw)) / 2 + dx;
  uiText(NFONT_TEMP, x, top + dy, tm, UI_WHITE);
  uiText(NFONT_TITLE, x + tw + 8, top + dy + NFONT_TEMP.h - NFONT_TITLE.h - 14, ap, UI_GREY);
  snprintf(line, sizeof(line), "%s, %s %d", uiDays[wd], uiMonths[Mo - 1], D);
  uiTextCentered(NFONT_BODY, top + dy + NFONT_TEMP.h + 2, line, UI_GREY);
  int y = (top + NFONT_TEMP.h + NFONT_BODY.h + 22) & ~1;
  if (uiIdle.showW && uiIdle.haveW) {
    char tp[12], sk[34];
    snprintf(tp, sizeof(tp), "%d%c", uiIdle.wt, (char)127);
    uiFit(sk, sizeof(sk), NFONT_MID, uiIdle.ws, 250);
    int tw2 = uiTextWidth(NFONT_TITLE, tp), sw = uiTextWidth(NFONT_MID, sk);
    int rowW = 64 + 14 + (tw2 > sw ? tw2 : sw);
    int x0 = ((UI_W - rowW) / 2 + dx) & ~1;                      // the row is centred under the clock
    uiRenderIconSmall(uiIdle.wi, UI_BLACK, 64);
    uiOut.blit(x0, y + dy, 64, 64, uiIconBuf);
    uiText(NFONT_TITLE, x0 + 78, y + dy - 2, tp, UI_WHITE);
    uiText(NFONT_MID, x0 + 78, y + dy + 38, sk, UI_GREY);
    y += 76;
  }
  if (uiIdle.showM && (uiIdle.haveM || uiIdle.mc)) {
    if (uiIdle.haveM) {
      char t2[34];
      uiFit(t2, sizeof(t2), NFONT_BODY, uiIdle.mt, 340);
      uiTextCentered(NFONT_BODY, y + dy, t2, UI_WHITE);
      int64_t now = uiUtcNow(ms);
      int64_t until = (int64_t)uiIdle.ms - now;
      char when[24], hh[8], aa[4];
      int Y2, M2, D2, h2, m2, w2;
      uiCivil((int64_t)uiIdle.ms + (int64_t)uiIdle.off * 60, &Y2, &M2, &D2, &h2, &m2, &w2);
      uiClockText(hh, aa, h2, m2);
      if (now >= (int64_t)uiIdle.ms) snprintf(when, sizeof(when), "now");
      else if (until < 3600) snprintf(when, sizeof(when), "in %d min", (int)((until + 59) / 60));
      else if (until < 86400) snprintf(when, sizeof(when), "in %d h %d min", (int)(until / 3600), (int)((until % 3600) / 60));
      else snprintf(when, sizeof(when), "tomorrow");
      snprintf(line, sizeof(line), "%s  %s %s", when, hh, aa);
      uiTextCentered(NFONT_MID, y + dy + NFONT_BODY.h + 2, line, UI_TEAL);
    } else {
      uiTextCentered(NFONT_MID, y + dy + 14, "No more meetings", UI_GREY);
    }
  }
  uiDrawBattery(bottom);
}

// Decides when the idle face comes and goes, and dims the screen after a while. Called from uiTick.
static void uiIdleTick(uint32_t ms) {
  if (uiShowDiag) {   // test builds: what the idle face thinks, once a second ("g" got facts, "a" after, "m" mode, "k" card, "i" idle on, "d" dim on / dimmed, "q" quiet seconds)
    static uint32_t lastDbg = 0;
    if (ms - lastDbg >= 1000) {
      lastDbg = ms;
      char b[72];
      snprintf(b, sizeof(b), "g%d a%d m%d k%d i%d d%d%d q%d b%d %02x %02x f%d r%d", uiIdle.have ? 1 : 0, uiIdle.after, uiMode, uiCard.on ? 1 : 0, uiIdleOn ? 1 : 0, uiIdle.dim ? 1 : 0, uiDimmed ? 1 : 0, (int)((ms - uiLastActive) / 1000), uiIdle.bat, uiBatRaw[0], uiBatRaw[1], uiFpsNow, (int)uiRenderMs);
      if (strcmp(b, uiIdleDbg) != 0) { strcpy(uiIdleDbg, b); uiDiagDirty = true; }
    }
  }
  if (!uiIdleOn) {
    if (uiIdle.have && uiIdle.after > 0 && uiMode == UI_READY && !uiCard.on && ms - uiLastActive >= (uint32_t)uiIdle.after * 1000UL) {
      uiIdleOn = true; uiIdleSince = ms; uiDimmed = false; uiIdleMinute = -1;
      uiWords[0] = 0; uiHeard[0] = 0;       // what was said is gone from the screen; waking starts fresh
      uiAll = true;
    }
    return;
  }
  if (uiMode != UI_READY || uiCard.on || !uiIdle.have || uiIdle.after == 0) { uiActivity(ms); return; }
  if (uiIdle.dim && !uiDimmed && ms - uiIdleSince >= UI_IDLE_DIM_MS) {
    uiDimmed = true;
    if (uiOut.brightness) uiOut.brightness(UI_DIM_LEVEL);
  }
  if ((int)((uiUtcNow(ms) + (int64_t)uiIdle.off * 60) / 60) != uiIdleMinute && !uiAll) { uiDrawIdle(ms); }   // a new minute
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
  if (uiIdleOn) { uiDrawIdle(uiNowMs); return; }
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
  if (uiIdleDbg[0]) uiTextCentered(NFONT_SMALL, 474, uiIdleDbg, UI_DIM);
  else if (uiDiag2[0]) uiTextCentered(NFONT_SMALL, 474, uiDiag2, UI_DIM);
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
  if (ms < uiReactUntil && uiMode != UI_LISTEN) eye = EYE_HAPPY;    // a giggle: a big smile throughout
  if (ms < uiLookUntil && uiMode != UI_LISTEN) {
    // His eyes follow a finger: where it is, relative to where his eyes are on the screen.
    float ex = p->footX + (NEDDY_EYE_CX - NEDDY_BODY_W * 0.5f) * p->scale;
    float ey = p->footY - (NEDDY_BODY_H - NEDDY_EYE_CY) * p->scale;
    float dx = (uiLookX - ex) / p->scale * 0.16f, dy = (uiLookY - ey) / p->scale * 0.12f;
    p->eyeDx = dx < -10 ? -10 : (dx > 10 ? 10 : dx);
    p->eyeDy = dy < -5.5f ? -5.5f : (dy > 5.5f ? 5.5f : dy);
    uiGlanceUntil = 0;
  } else if (uiMotion) {
    if (uiMode == UI_READY && ms >= uiNextGlance) { uiGlanceUntil = ms + 800; uiNextGlance = ms + 4000 + (uiRand() % 5000); uiGlanceDx = (uiRand() & 1) ? 4.0f : -4.0f; }
    if (ms < uiGlanceUntil) p->eyeDx = uiGlanceDx;
    if (uiMode == UI_THINK) p->eyeDx = 4.0f * sinf(ms * 0.0028f);
    if (uiLookupOn && uiMode == UI_THINK) { p->eyeDx = 5.0f * sinf(ms * 0.0075f); p->eyeDy = 3.0f; }   // reading: eyes sweep along the page
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
  if (ms < uiReactUntil) {
    // The giggle: quick little hops and a wiggle that settle over a second (works even with motion off).
    float k = (uiReactUntil - ms) / 1000.0f, t = (1.0f - k);
    float hop = fabsf(sinf(t * 22.0f)) * 9.0f * k * p->scale;
    p->footY -= hop;
    p->sway += sinf(t * 31.0f) * 7.0f * k * p->scale;
    p->breath += sinf(t * 25.0f) * 0.02f * k;
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
  uiNowMs = ms; uiLookupNow = ms;
  if (uiScreenOff) return;
  if (uiRec.state != UI_RECS_OFF) {                 // the recorder owns the screen; nothing else is drawn or woken
    uiLastActive = ms;
    if (uiRec.state == UI_RECS_RUN && !uiRec.dimmed && ms - uiRec.lastTouch > UI_REC_DIM_MS) { uiRec.dimmed = true; if (uiOut.brightness) uiOut.brightness(40); }
    if (uiRec.full || uiRec.dirty) uiRecDraw();
    return;
  }
  // The look-up ends when the server says so (it does before the answer is read), when he is spoken to again, or after 45 s whatever happens.
  // Speaking does NOT end it: he usually says "let me check" first, and the look-up only starts after that.
  if (uiLookupOn && (uiMode == UI_LISTEN || uiMode == UI_LINK || ms - uiLookupSince > 45000)) uiLookupOn = false;
  if (uiLookupOn) uiActivity(ms);                   // a look-up in progress is activity: the idle face doesn't take over meanwhile
  if (uiCard.on && ms - uiCard.since >= uiCardMs()) uiClearCard();
  uiIdleTick(ms);
  bool wantSmall = uiCard.on || uiIdleOn || ((uiWords[0] || uiHeard[0]) && uiMode != UI_LISTEN && uiMode != UI_LINK);
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
  // The small diagnostic lines at the bottom change by themselves (Wi-Fi strength, timings): redraw only that band, and only when it is shown.
  if (uiDiagDirty) {
    if (uiShowDiag && !uiCard.on && !uiIdleOn && uiMode != UI_LISTEN && ms - uiLastDiag >= 900) { uiDrawDiag(); uiDiagDirty = false; uiLastDiag = ms; }
    else if (!uiShowDiag || uiCard.on || uiIdleOn) uiDiagDirty = false;
  }
  bool draw = false;
  if (p.eye != uiLastEye) draw = true;                       // eyes changed (blink, listening level...)
  // Moving: about 16 frames a second, but never more often than drawing allows (drawing may take 40% of the time at most;
  // while he is listening, only 20%, so no sound is missed).
  uint32_t gap = uiFpsLevel == 0 ? 125 : uiFpsLevel == 2 ? 33 : 60;   // saver ~8, normal ~16, smooth ~30 frames a second at most
  if (uiMicros) {
    float share = uiMode == UI_LISTEN ? 5.0f : 2.5f;
    uint32_t need = (uint32_t)(uiRenderMs * share);
    if (need > gap) gap = need;
    if (uiMode == UI_LISTEN && gap < 150) gap = 150;
  }
  if ((uiMotion || uiLookupOn || ms < uiReactUntil || ms < uiLookUntil) && ms - uiLastStage >= gap) draw = true;
  if (draw) {
    uiDrawStage(p);
    uiLastEye = p.eye; uiLastStage = ms; uiFrames++;
  }
  if (ms - uiFpsAt >= 1000) { uiFpsNow = uiFrames; uiFrames = 0; uiFpsAt = ms; }
}
