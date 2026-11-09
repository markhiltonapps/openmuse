// neddy_ui.h: Neddy's screen. The whole robot (it can move all the time), glowing eyes that change with
// what's happening, smooth text, and a layout where he shrinks when words appear.
//
// Portable on purpose: the watch (neddy_device.ino) and a test on a computer (firmware/tools/ui_sim.cpp)
// build this same file, so the drawing can be checked on a PC before it ever runs on the board.
#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>
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

static int uiTextWidth(const NeddyFont &f, const char *s) {
  int w = 0;
  for (; *s; s++) {
    int c = (uint8_t)*s;
    if (c < 32 || c > 126) c = '?';
    w += f.adv[c - 32];
  }
  return w;
}

static void uiText(const NeddyFont &f, int x, int y, const char *s, uint16_t fg) {
  int w = uiTextWidth(f, s);
  if (w <= 0) return;
  if (x < 0) x = 0;
  if (x + w > UI_W) w = UI_W - x;
  if (w <= 0) return;
  int h = f.h;
  int chunk = (int)(sizeof(uiLine) / sizeof(uiLine[0])) / w;   // rows that fit the buffer (a tall font is sent in strips)
  if (chunk > h) chunk = h;
  int fr = (fg >> 11) & 31, fgc = (fg >> 5) & 63, fb = fg & 31;
  for (int r0 = 0; r0 < h; r0 += chunk) {
    int rows = h - r0 < chunk ? h - r0 : chunk;
    memset(uiLine, 0, (size_t)w * rows * 2);
    int cx = 0;
    for (const char *p = s; *p && cx < w; p++) {
      int c = (uint8_t)*p;
      if (c < 32 || c > 126) c = '?';
      int a = f.adv[c - 32];
      const uint8_t *g = f.bits + f.off[c - 32];
      for (int row = r0; row < r0 + rows; row++) {
        for (int col = 0; col < a && cx + col < w; col++) {
          int al = g[row * a + col];
          if (!al) continue;
          int r = (fr * al + 127) / 255, gg = (fgc * al + 127) / 255, b = (fb * al + 127) / 255;
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
      if (c < 32 || c > 126) c = '?';
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
      for (int i = 0; i < sw; i++) {
        float sxf = sxf0 + i * dsx;
        int r5 = 0, g6 = 0, b5 = 0;
        if (inBody) {
          float u = sxf * k - 0.5f;
          if (u < 0) u = 0;
          int ix = (int)u; int fx = (int)((u - ix) * 256.0f);
          if (ix > srcW - 1) { ix = srcW - 1; fx = 0; }
          int ix1 = ix + 1 > srcW - 1 ? srcW - 1 : ix + 1;
          uint16_t c00 = row0[ix], c10 = row0[ix1], c01 = row1[ix], c11 = row1[ix1];
          int w00 = (256 - fx) * (256 - fy), w10 = fx * (256 - fy), w01 = (256 - fx) * fy, w11 = fx * fy;
          r5 = (((c00 >> 11) * w00) + ((c10 >> 11) * w10) + ((c01 >> 11) * w01) + ((c11 >> 11) * w11)) >> 16;
          g6 = ((((c00 >> 5) & 63) * w00) + (((c10 >> 5) & 63) * w10) + (((c01 >> 5) & 63) * w01) + (((c11 >> 5) & 63) * w11)) >> 16;
          b5 = (((c00 & 31) * w00) + ((c10 & 31) * w10) + ((c01 & 31) * w01) + ((c11 & 31) * w11)) >> 16;
          if (eyeRow) {
            float exv = sxf - eyeCx + NEDDY_SPR_W * 0.5f;
            if (exv >= 0 && exv < NEDDY_SPR_W) {
              uint16_t e = eyes[eyi * NEDDY_SPR_W + (int)exv];
              if (e) {
                r5 += e >> 11; g6 += (e >> 5) & 63; b5 += e & 31;
                if (r5 > 31) r5 = 31;
                if (g6 > 63) g6 = 63;
                if (b5 > 31) b5 = 31;
              }
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
static bool uiMotion = false;        // true: he moves all the time. false: still, except blinking.
static bool uiSmall = false;         // the layout now showing
static bool uiAll = true, uiTextDirty = true, uiLevelDirty = false;
static uint32_t uiNextBlink = 0, uiBlinkUntil = 0, uiNextGlance = 0, uiGlanceUntil = 0;
static float uiGlanceDx = 0;
static uint32_t uiRng = 12345;
static int uiLastEye = -1;
static int uiStageX = 0, uiStageY = 0, uiStageW = 0, uiStageH = 0;
static uint32_t uiLastStage = 0, uiLastText = 0;

static uint32_t uiRand() { uiRng = uiRng * 1664525u + 1013904223u; return uiRng >> 8; }

static void uiSetMode(int m) { if (m != uiMode) { uiMode = m; uiAll = true; } }
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

static void uiBasePose(UiPose *p) {
  p->breath = 0; p->sway = 0; p->eyeDx = 0; p->eyeDy = 0; p->eye = EYE_HAPPY;
  p->glow = uiModeColour();
  if (uiSmall) { p->scale = 0.5f; p->footX = UI_W / 2.0f; p->footY = 8 + NEDDY_BODY_H * 0.5f; }
  else { p->scale = 1.0f; p->footX = UI_W / 2.0f; p->footY = 14 + NEDDY_BODY_H; }
}

static void uiTextAreas(int *top, int *bottom) {
  *top = uiStageY + uiStageH + 2; *bottom = 450;
}

static void uiDrawText() {
  int top, bottom;
  uiTextAreas(&top, &bottom);
  uiOut.fill(0, top, UI_W, bottom - top, UI_BLACK);
  uint16_t col = uiModeColour();
  uiTextCentered(NFONT_TITLE, top + 2, uiModeLabel(), col);
  int y = top + 40;
  if (uiMode == UI_LISTEN) {
    // a rounded level bar
    int bx = 85, bw = 240, by = y + 4;
    uiOut.fill(bx, by, bw, 14, uiRgb(70, 74, 80));
    uiOut.fill(bx + 2, by + 2, bw - 4, 10, UI_BLACK);
    int fw = (int)((bw - 4) * uiLevel);
    if (fw > 0) uiOut.fill(bx + 2, by + 2, fw, 10, col);
    return;
  }
  if (uiHeard[0]) y = uiParagraph(NFONT_MID, y, uiHeard, UI_GREY, 330, 2, 22) + 4;
  if (uiWords[0]) {
    int lines = (448 - y) / 26;
    if (lines > 9) lines = 9;
    if (lines > 0) uiParagraph(NFONT_BODY, y, uiWords, UI_WHITE, 340, lines, 26);
  } else if (!uiSmall && uiName[0]) {
    uiTextCentered(NFONT_MID, y, uiName, UI_GREY);
  }
}

static void uiDrawLevelOnly() {
  int top, bottom;
  uiTextAreas(&top, &bottom);
  int y = top + 40, bx = 85, bw = 240, by = y + 4;
  uiOut.fill(bx + 2, by + 2, bw - 4, 10, UI_BLACK);
  int fw = (int)((bw - 4) * uiLevel);
  if (fw > 0) uiOut.fill(bx + 2, by + 2, fw, 10, uiModeColour());
}

static void uiDrawDiag() {
  uiOut.fill(0, 452, UI_W, 50, UI_BLACK);
  if (uiDiag1[0]) uiTextCentered(NFONT_SMALL, 458, uiDiag1, UI_DIM);
  if (uiDiag2[0]) uiTextCentered(NFONT_SMALL, 475, uiDiag2, UI_DIM);
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
static void uiTick(uint32_t ms) {
  bool wantSmall = (uiWords[0] || uiHeard[0]) && uiMode != UI_LISTEN && uiMode != UI_LINK;
  if (wantSmall != uiSmall) { uiSmall = wantSmall; uiAll = true; }
  UiPose p;
  uiPoseNow(ms, &p);
  if (uiAll) {
    uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
    UiPose nominal; uiBasePose(&nominal);
    uiStageRect(nominal, &uiStageX, &uiStageY, &uiStageW, &uiStageH);
    uiDrawText();
    uiDrawDiag();
    uiRenderStage(p, uiStageX, uiStageY, uiStageW, uiStageH);
    uiAll = false; uiTextDirty = false; uiLevelDirty = false; uiLastEye = p.eye; uiLastStage = ms;
    return;
  }
  if (uiTextDirty && ms - uiLastText >= 120) { uiDrawText(); uiDrawDiag(); uiTextDirty = false; uiLevelDirty = false; uiLastText = ms; }
  else if (uiLevelDirty) { if (uiMode == UI_LISTEN) uiDrawLevelOnly(); uiLevelDirty = false; }
  bool draw = false;
  if (p.eye != uiLastEye) draw = true;                       // eyes changed (blink, listening level...)
  if (uiMotion && ms - uiLastStage >= 60) draw = true;       // moving: about 16 frames a second
  if (draw) {
    uiRenderStage(p, uiStageX, uiStageY, uiStageW, uiStageH);
    uiLastEye = p.eye; uiLastStage = ms;
  }
}
