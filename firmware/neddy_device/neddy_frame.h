// The last step before pixels reach the round screen: turning the picture (auto-rotate) and the button marks.
// Pure code (no hardware, no Arduino), so a computer can run it: firmware/tools/frame_test.cpp.
//
// Everything the UI draws is in "upright" (logical) coordinates. This layer:
//   - turns each window by quarter turns (frRot 0..3, clockwise) before it goes to the screen, so the picture stays
//     right side up when the watch is held sideways or upside down (the screen is square, 466 x 466, so every window
//     stays on even numbers, as the AMOLED chip wants);
//   - lays the button marks on top of whatever is drawn under them (a short glowing arc on the rim next to each of the
//     watch's two buttons, with a small word: TALK, MENU, BACK, STOP), so no screen can wipe them out by drawing;
//   - turns a touch on the glass back into upright coordinates.
// The marks follow the real buttons: a button's place is fixed on the case (big at about 1 o'clock, small at about
// 4 o'clock with the watch upright), so when the picture turns, its mark moves round the rim to stay next to it.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#ifndef FR_SIZE
#define FR_SIZE 466                 // the round screen is square
#endif
#define FR_BUF_PX 2048              // the turning buffer (a few rows of the widest window at a time)
#define FR_RIM_R 225.0f             // the arc's centre line: just inside the glass's edge (radius 233)
#define FR_ARC_T 6.0f               // the arc's thickness
#define FR_ARC_LEN 62.0f            // the arc's length along the rim
#define FR_TEXT_GAP 14              // the word starts this far inside the arc
#define FR_LAYER_MAX (76 * 76)      // the biggest mask (an arc at 45 degrees)
#define FR_MARKS 2

typedef void (*FrBlitFn)(int x, int y, int w, int h, uint16_t *px);
typedef void (*FrFillFn)(int x, int y, int w, int h, uint16_t colour);
typedef void *(*FrAllocFn)(size_t bytes);

struct FrLayer { int x, y, w, h; uint8_t *a; };
struct FrMark {
  bool on;
  int angle;                        // where the button is on the case, degrees clockwise from 12 (watch upright)
  uint16_t colour;                  // the arc
  uint16_t wordColour;              // the word (0 = the same as the arc)
  char word[8];
  FrLayer arc, text;
  float spanMid, spanHalf;          // the angles the mark covers in the picture (radians, clockwise from 12), arc and word together
};

static FrBlitFn frHwBlit = 0;
static FrFillFn frHwFill = 0;
static uint16_t frBuf[FR_BUF_PX];
static int frRot = 0;               // quarter turns, clockwise
static FrMark frMarks[FR_MARKS];
static bool frReady = false;        // the mask memory was found
static bool frHideMarks = false;    // tests only: draw without laying the marks on top (everything else, such as the gaps made for them, stays)

// ------------------------------------------------------------------ coordinates
// Where a window in upright coordinates lands on the glass.
static inline void frPhysRect(int rot, int x, int y, int w, int h, int *px, int *py, int *pw, int *ph) {
  const int S = FR_SIZE;
  switch (rot & 3) {
    case 0: *px = x; *py = y; *pw = w; *ph = h; break;
    case 1: *px = S - y - h; *py = x; *pw = h; *ph = w; break;
    case 2: *px = S - x - w; *py = S - y - h; *pw = w; *ph = h; break;
    default: *px = y; *py = S - x - w; *pw = h; *ph = w; break;
  }
}
// A point on the glass, back in upright coordinates (for touches).
static inline void frToUpright(int rot, int px, int py, int *lx, int *ly) {
  const int S = FR_SIZE;
  switch (rot & 3) {
    case 0: *lx = px; *ly = py; break;
    case 1: *lx = py; *ly = S - 1 - px; break;
    case 2: *lx = S - 1 - px; *ly = S - 1 - py; break;
    default: *lx = S - 1 - py; *ly = px; break;
  }
}
// The other way: an upright point on the glass.
static inline void frToGlass(int rot, int lx, int ly, int *px, int *py) {
  const int S = FR_SIZE;
  switch (rot & 3) {
    case 0: *px = lx; *py = ly; break;
    case 1: *px = S - 1 - ly; *py = lx; break;
    case 2: *px = S - 1 - lx; *py = S - 1 - ly; break;
    default: *px = ly; *py = S - 1 - lx; break;
  }
}
// Where a button on the case appears in the upright picture, in degrees clockwise from 12.
static inline int frScreenAngle(int caseAngle, int rot) { return ((caseAngle - 90 * (rot & 3)) % 360 + 360) % 360; }

// ------------------------------------------------------------------ marks
static inline uint16_t frBlend(uint16_t bg, uint16_t fg, int a) {   // a: 0..255
  if (a >= 255) return fg;
  int br = bg >> 11, bgg = (bg >> 5) & 63, bb = bg & 31, fr = fg >> 11, fgg = (fg >> 5) & 63, fb = fg & 31;
  int r = br + ((fr - br) * a + 127) / 255, g = bgg + ((fgg - bgg) * a + 127) / 255, b = bb + ((fb - bb) * a + 127) / 255;
  return (uint16_t)((r << 11) | (g << 5) | b);
}
static inline bool frLayerHits(const FrLayer &l, int x, int y, int w, int h) {
  return l.a && l.w > 0 && x < l.x + l.w && l.x < x + w && y < l.y + l.h && l.y < y + h;
}
static bool frHits(int x, int y, int w, int h) {
  if (frHideMarks) return false;
  for (int i = 0; i < FR_MARKS; i++)
    if (frMarks[i].on && (frLayerHits(frMarks[i].arc, x, y, w, h) || frLayerHits(frMarks[i].text, x, y, w, h))) return true;
  return false;
}
static inline uint16_t frOver(int lx, int ly, uint16_t c) {
  for (int i = 0; i < FR_MARKS; i++) {
    const FrMark &m = frMarks[i];
    if (!m.on) continue;
    const FrLayer *ls[2] = { &m.arc, &m.text };
    for (int j = 0; j < 2; j++) {
      const FrLayer &l = *ls[j];
      if (!l.a || lx < l.x || ly < l.y || lx >= l.x + l.w || ly >= l.y + l.h) continue;
      int a = l.a[(ly - l.y) * l.w + (lx - l.x)];
      if (a) c = frBlend(c, j && m.wordColour ? m.wordColour : m.colour, a);
    }
  }
  return c;
}

// Memory for the masks (on the watch: the big PSRAM, so the small fast memory stays free for secure connections).
static bool frInit(FrAllocFn alloc) {
  frReady = true;
  for (int i = 0; i < FR_MARKS; i++) {
    frMarks[i].on = false;
    frMarks[i].arc.a = (uint8_t *)alloc(FR_LAYER_MAX);
    frMarks[i].text.a = (uint8_t *)alloc(FR_LAYER_MAX);
    if (!frMarks[i].arc.a || !frMarks[i].text.a) frReady = false;
  }
  return frReady;
}

static inline float frClamp01(float v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Draws a mark's arc and word into its masks, for the current turn of the picture. The word bends along the rim just
// inside the arc (like the watch's curved titles), reading left to right: on the top half its letters stand on the rim,
// on the bottom half they hang from it. It leans from the arc toward the nearer side (3 or 9 o'clock), where a round
// screen has the least on it, so it keeps clear of titles at the top and labels at the bottom. The font is passed as
// plain pointers (advance widths and 8-bit coverage, the watch's NeddyFont) so this header doesn't need the font file.
#define FR_WORD_MAX 96              // the widest word, in pixels
#define FR_TRACK 1                  // extra space between letters (small capitals read better a little apart)
static void frBuildMark(FrMark &m, int fontH, const uint8_t *adv, const uint32_t *off, const uint8_t *bits) {
  const float C = FR_SIZE / 2.0f, PI = 3.14159265f;
  float th = (float)frScreenAngle(m.angle, frRot) * PI / 180.0f;
  // The arc: a short thick piece of the rim with rounded ends.
  float half = FR_ARC_LEN / 2.0f / FR_RIM_R;                 // half its length, in radians
  float x0 = 1e9f, y0 = 1e9f, x1 = -1e9f, y1 = -1e9f;
  for (int k = 0; k <= 8; k++) {                             // its box: sample the centre line, pad by the thickness
    float t = th - half + 2 * half * k / 8.0f;
    float px = C + FR_RIM_R * sinf(t), py = C - FR_RIM_R * cosf(t);
    x0 = fminf(x0, px); x1 = fmaxf(x1, px); y0 = fminf(y0, py); y1 = fmaxf(y1, py);
  }
  int ax = ((int)floorf(x0 - FR_ARC_T)) & ~1, ay = ((int)floorf(y0 - FR_ARC_T)) & ~1;
  int aw = (((int)ceilf(x1 + FR_ARC_T) - ax) + 1) & ~1, ah = (((int)ceilf(y1 + FR_ARC_T) - ay) + 1) & ~1;
  if (ax < 0) { aw += ax; ax = 0; }
  if (ay < 0) { ah += ay; ay = 0; }
  if (ax + aw > FR_SIZE) aw = (FR_SIZE - ax) & ~1;
  if (ay + ah > FR_SIZE) ah = (FR_SIZE - ay) & ~1;
  if (aw * ah > FR_LAYER_MAX) { ah = (FR_LAYER_MAX / aw) & ~1; }
  m.arc.x = ax; m.arc.y = ay; m.arc.w = aw; m.arc.h = ah;
  for (int yy = 0; yy < ah; yy++)
    for (int xx = 0; xx < aw; xx++) {
      float px = ax + xx + 0.5f - C, py = ay + yy + 0.5f - C;
      float r = sqrtf(px * px + py * py);
      float dphi = atan2f(px, -py) - th;                      // clockwise from 12, relative to the button
      while (dphi > PI) dphi -= 2 * PI;
      while (dphi < -PI) dphi += 2 * PI;
      float s = fabsf(dphi) * FR_RIM_R - FR_ARC_LEN / 2.0f;   // past the arc's end, along the rim
      float dr = r - FR_RIM_R;
      float d = s > 0 ? sqrtf(s * s + dr * dr) - FR_ARC_T / 2.0f : fabsf(dr) - FR_ARC_T / 2.0f;
      m.arc.a[yy * aw + xx] = (uint8_t)(frClamp01(0.5f - d) * 255.0f + 0.5f);
    }
  m.spanMid = th; m.spanHalf = half + 12.0f / FR_RIM_R;
  // The word, first laid flat.
  static uint8_t flat[FR_WORD_MAX * 48];
  int tw = 0;
  for (const char *p = m.word; *p; p++) { int c = (uint8_t)*p; if (c < 32 || c > 127) c = '?'; tw += adv[c - 32] + FR_TRACK; }
  tw -= FR_TRACK;
  m.text.w = 0;
  if (tw == 0 || tw > FR_WORD_MAX || fontH > 48) return;
  memset(flat, 0, sizeof(flat));
  for (int cx = 0, i = 0; m.word[i]; i++) {
    int c = (uint8_t)m.word[i]; if (c < 32 || c > 127) c = '?';
    int a = adv[c - 32];
    const uint8_t *g = bits + off[c - 32];
    for (int row = 0; row < fontH; row++) for (int col = 0; col < a && cx + col < FR_WORD_MAX; col++) flat[row * FR_WORD_MAX + cx + col] = g[row * a + col];
    cx += a + FR_TRACK;
  }
  // Then bent along the rim.
  float rOut = FR_RIM_R - FR_ARC_T / 2.0f - 2.0f, rIn = rOut - fontH, rMid = (rOut + rIn) / 2.0f;
  float span = tw / rMid;                                     // how much of the rim it takes, radians
  float deg = th * 180.0f / PI;
  bool top = deg < 90.0f || deg >= 270.0f;                    // on the top half it reads clockwise; on the bottom half, the other way
  int side = (deg > 0.5f && deg < 90.0f) || (deg > 180.0f && deg < 270.0f) ? 1 : (deg > 90.0f && deg < 180.0f) || deg > 270.0f ? -1 : 0;
  float mid = th + side * span * 0.3f;                        // leaning toward 3 or 9 o'clock
  m.spanMid = (th + mid) / 2.0f;
  m.spanHalf = fmaxf(half, fabsf(mid - th) + span / 2.0f) + 12.0f / FR_RIM_R;
  x0 = 1e9f; y0 = 1e9f; x1 = -1e9f; y1 = -1e9f;
  for (int k = 0; k <= 12; k++)
    for (int j = 0; j < 2; j++) {
      float t = mid - span / 2.0f + span * k / 12.0f, r = j ? rOut : rIn;
      float px = C + r * sinf(t), py = C - r * cosf(t);
      x0 = fminf(x0, px); x1 = fmaxf(x1, px); y0 = fminf(y0, py); y1 = fmaxf(y1, py);
    }
  int tx = ((int)floorf(x0 - 2)) & ~1, ty = ((int)floorf(y0 - 2)) & ~1;
  int twE = (((int)ceilf(x1 + 2) - tx) + 1) & ~1, thE = (((int)ceilf(y1 + 2) - ty) + 1) & ~1;
  if (twE * thE > FR_LAYER_MAX) return;
  m.text.x = tx; m.text.y = ty; m.text.w = twE; m.text.h = thE;
  for (int yy = 0; yy < thE; yy++)
    for (int xx = 0; xx < twE; xx++) {
      float px = tx + xx + 0.5f - C, py = ty + yy + 0.5f - C;
      float r = sqrtf(px * px + py * py);
      float dphi = atan2f(px, -py) - mid;
      while (dphi > PI) dphi -= 2 * PI;
      while (dphi < -PI) dphi += 2 * PI;
      // where this point falls in the flat word (u along, v down from the letters' tops), read with a little smoothing
      float u = tw / 2.0f + (top ? dphi : -dphi) * rMid - 0.5f;
      float v = (top ? rOut - r : r - rIn) - 0.5f;
      int a = 0;
      if (u > -1 && v > -1 && u < tw && v < fontH) {
        int u0 = (int)floorf(u), v0 = (int)floorf(v);
        float fu = u - u0, fv = v - v0, acc = 0;
        for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
          int uu = u0 + dx, vv = v0 + dy;
          if (uu < 0 || vv < 0 || uu >= tw || vv >= fontH) continue;
          acc += flat[vv * FR_WORD_MAX + uu] * (dx ? fu : 1 - fu) * (dy ? fv : 1 - fv);
        }
        a = (int)(acc + 0.5f);
      }
      m.text.a[yy * twE + xx] = (uint8_t)(a > 255 ? 255 : a);
    }
}
// True when a point in the picture is close to a mark (anything drawn round the rim there, like the recording screen's
// ring of dots, should leave a gap for it).
static inline bool frNearMark(float lx, float ly) {
  const float C = FR_SIZE / 2.0f, PI = 3.14159265f;
  float px = lx - C, py = ly - C;
  if (px * px + py * py < 150.0f * 150.0f) return false;
  float phi = atan2f(px, -py);
  for (int i = 0; i < FR_MARKS; i++) {
    if (!frMarks[i].on) continue;
    float d = phi - frMarks[i].spanMid;
    while (d > PI) d -= 2 * PI;
    while (d < -PI) d += 2 * PI;
    if (fabsf(d) <= frMarks[i].spanHalf) return true;
  }
  return false;
}

// ------------------------------------------------------------------ output
// Sends one window (from `src`, or filled with one colour when src is null) to the glass, turned and with the marks on top.
static void frEmit(int x, int y, int w, int h, uint16_t *src, uint16_t fillc) {
  if (w <= 0 || h <= 0) return;
  bool hit = frHits(x, y, w, h);
  if (!hit && frRot == 0) { if (src) frHwBlit(x, y, w, h, src); else frHwFill(x, y, w, h, fillc); return; }
  int px, py, pw, ph;
  frPhysRect(frRot, x, y, w, h, &px, &py, &pw, &ph);
  if (!hit && !src) { frHwFill(px, py, pw, ph, fillc); return; }
  int rows = (FR_BUF_PX / pw) & ~1;
  if (rows < 2) rows = 2;
  // For each row on the glass: where its first pixel comes from (upright x, y) and how that moves along the row.
  int dlx, dly;
  switch (frRot & 3) { case 0: dlx = 1; dly = 0; break; case 1: dlx = 0; dly = -1; break; case 2: dlx = -1; dly = 0; break; default: dlx = 0; dly = 1; break; }
  for (int r0 = 0; r0 < ph; r0 += rows) {
    int n = ph - r0 < rows ? ph - r0 : rows;
    for (int pr = 0; pr < n; pr++) {
      int lx, ly;
      frToUpright(frRot, px, py + r0 + pr, &lx, &ly);
      uint16_t *out = frBuf + pr * pw;
      if (src) {
        long idx = (long)(ly - y) * w + (lx - x), step = dlx + (long)dly * w;
        if (hit) for (int c = 0; c < pw; c++, idx += step, lx += dlx, ly += dly) out[c] = frOver(lx, ly, src[idx]);
        else for (int c = 0; c < pw; c++, idx += step) out[c] = src[idx];
      } else {
        for (int c = 0; c < pw; c++, lx += dlx, ly += dly) out[c] = frOver(lx, ly, fillc);
      }
    }
    frHwBlit(px, py + r0, pw, n, frBuf);
  }
}
static void frBlit(int x, int y, int w, int h, uint16_t *px) { frEmit(x, y, w, h, px, 0); }
static void frFill(int x, int y, int w, int h, uint16_t c) { frEmit(x, y, w, h, 0, c); }

// ------------------------------------------------------------------ which way up
// Decides the turn from gravity in the screen's own directions (milli-g, 1000 = 1 g): `downX` points right and `downY`
// points down the screen when the watch is upright, so an upright watch reads about (0, +1000); `face` is the part
// through the glass. Only a clear tilt held still for half a second turns the picture: lying flat or nearly flat, being
// shaken, sitting between two sides, or held with the glass standing upright (an arm hanging down, lying on your side) changes nothing.
#define FR_TILT_MG 650              // at least this much of gravity across the glass (tilted about 40 degrees or more)
#define FR_FACE_MG 250              // ...and the glass leaning back toward a face at least this much (about 15 degrees): an arm hanging down,
                                    // lying on your side or a pocket hold the glass upright, and those keep the turn they have
#define FR_SETTLE_MS 500
struct FrOrient { int cand; uint32_t since; };
static inline void frOrientReset(FrOrient &o) { o.cand = -1; o.since = 0; }
static int frOrientFeed(FrOrient &o, int cur, uint32_t ms, int downX, int downY, int face) {
  long total2 = (long)downX * downX + (long)downY * downY + (long)face * face;
  if (total2 < 700L * 700L || total2 > 1300L * 1300L) { o.cand = -1; return cur; }      // moving, not just tilted
  long across2 = (long)downX * downX + (long)downY * downY;
  if (across2 < (long)FR_TILT_MG * FR_TILT_MG) { o.cand = -1; return cur; }              // flat enough: keep what it is
  if (abs(face) < FR_FACE_MG) { o.cand = -1; return cur; }                               // the glass stands upright: nobody is looking at it this way
  int ax = abs(downX), ay = abs(downY), q;
  if (ay * 10 >= ax * 17) q = downY > 0 ? 0 : 2;              // clearly along the up-down line (within 30 degrees)
  else if (ax * 10 >= ay * 17) q = downX > 0 ? 3 : 1;         // clearly along the side-to-side line
  else { o.cand = -1; return cur; }                           // in between: keep what it is
  if (q == cur) { o.cand = -1; return cur; }
  if (o.cand != q) { o.cand = q; o.since = ms; return cur; }
  if (ms - o.since >= FR_SETTLE_MS) { o.cand = -1; return q; }
  return cur;
}
