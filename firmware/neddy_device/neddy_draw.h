// neddy_draw.h: the drawing kit for the watch's screens, for a round screen and a rectangular one alike.
// Soft-edged shapes (discs, rings, lines, arcs, rounded boxes) painted a strip at a time, text that follows a curve, the line icons
// and where things go on a screen of either shape. Included by neddy_ui.h after its text code; like it, nothing here touches
// the Arduino, so the PC test (firmware/tools/ui_sim.cpp) draws exactly what the watch draws.
//
// The screen wants every window on even pixels (see uiText), so every painted box is lined up on even numbers.
#pragma once

#define UI_CX (UI_W / 2)
#define UI_CY (UI_H / 2)

// ---- colours: the person's accent (amber by default; blue, green or pink from Settings > Colour or by voice)
static const uint16_t UI_ACCENTS[4] = { uiRgb(255, 172, 64), uiRgb(96, 172, 255), uiRgb(104, 222, 146), uiRgb(255, 104, 156) };
static const char *const UI_ACCENT_NAMES[4] = { "Amber", "Blue", "Green", "Pink" };
static int uiAccentIdx = 0;
static uint16_t uiAcc() { return UI_ACCENTS[uiAccentIdx & 3]; }
static uint16_t uiBlend(uint16_t a, uint16_t b, float t) {      // t = 0: a, 1: b
  int ar = (a >> 11) & 31, ag = (a >> 5) & 63, ab = a & 31, br = (b >> 11) & 31, bg = (b >> 5) & 63, bb = b & 31;
  return (uint16_t)(((int)(ar + (br - ar) * t + 0.5f) << 11) | ((int)(ag + (bg - ag) * t + 0.5f) << 5) | (int)(ab + (bb - ab) * t + 0.5f));
}
static uint16_t uiAccDim() { return uiBlend(UI_BLACK, uiAcc(), 0.30f); }
static constexpr uint16_t UI_LABEL = uiRgb(236, 232, 248);      // labels: a slightly cool white, like the reference
static constexpr uint16_t UI_REC_RED = uiRgb(255, 64, 56);

// ---- the screen's shape. Round: a circle of radius UI_W/2. Rectangle: the 2.06's panel, whose corners are rounded (about 46 px).
#define UI_CORNER 46
// Half the width that can be used at row y (from the middle), `margin` px in from the edge.
static int uiHalfAt(int y, int margin) {
#if NEDDY_ROUND
  float R = UI_W * 0.5f - margin, dy = (y + 0.5f) - UI_CY;
  return R * R > dy * dy ? (int)sqrtf(R * R - dy * dy) : 0;
#else
  int half = UI_W / 2 - margin, c = UI_CORNER;
  int dy = y < c ? c - y : (y > UI_H - 1 - c ? y - (UI_H - 1 - c) : 0);
  if (dy > 0) { float in = c - sqrtf((float)(c * c - (dy > c ? c : dy) * (dy > c ? c : dy))); half -= (int)in; }
  return half > 0 ? half : 0;
#endif
}
// The narrowest half width over rows y0..y1: text in that band fits when it is no wider than twice this.
static int uiHalfBand(int y0, int y1, int margin) {
  int a = uiHalfAt(y0, margin), b = uiHalfAt(y1, margin);
  int m = a < b ? a : b;
  if (y0 < UI_CY && y1 > UI_CY) return m;
  return m;
}
// A point around the screen's edge, `inset` px in: t from 0 to 1 goes once round, clockwise, starting at the top middle.
static void uiEdgePoint(float t, float inset, float *x, float *y) {
  float a = t * 6.2831853f - 1.5707963f;
#if NEDDY_ROUND
  float r = UI_W * 0.5f - inset;
  *x = UI_CX + r * cosf(a); *y = UI_CY + r * sinf(a);
#else
  // A rounded rectangle: the same direction from the middle, pushed out until it meets the outline.
  float hw = UI_W * 0.5f - inset, hh = UI_H * 0.5f - inset, rc = UI_CORNER + 14 - inset * 0.3f;
  float dx = cosf(a), dy = sinf(a);
  float lo = 0, hi = UI_W + UI_H;
  for (int i = 0; i < 24; i++) {                       // halve the distance until the point sits on the outline
    float m = (lo + hi) * 0.5f, px = fabsf(dx * m), py = fabsf(dy * m);
    float qx = px - (hw - rc), qy = py - (hh - rc);
    float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, in = qx > qy ? qx : qy;
    float d = sqrtf(ox * ox + oy * oy) + (in < 0 ? in : 0) - rc;
    if (d < 0) lo = m; else hi = m;
  }
  *x = UI_CX + dx * lo; *y = UI_CY + dy * lo;
#endif
}

// A plain fill lined up on even pixels (the middle of the screen, UI_CX, is an odd number on both screens).
static void uiFillE(int x, int y, int w, int h, uint16_t c) {
  int x0 = x & ~1, y0 = y & ~1;
  w = (w + (x - x0) + 1) & ~1; h = (h + (y - y0) + 1) & ~1;
  if (x0 < 0) { w += x0; x0 = 0; }
  if (y0 < 0) { h += y0; y0 = 0; }
  if (x0 + w > UI_W) w = (UI_W - x0) & ~1;
  if (y0 + h > UI_H) h = (UI_H - y0) & ~1;
  if (w > 0 && h > 0) uiOut.fill(x0, y0, w, h, c);
}

// ---- soft-edged shapes. Add them, then paint a box: every pixel of the box starts as the background and each shape whose
// bounds reach it is blended in by how much of the pixel it covers. Painting replaces what was in the box.
enum { UI_SH_DISC, UI_SH_RING, UI_SH_SEG, UI_SH_ARC, UI_SH_BOX, UI_SH_BOXRING, UI_SH_CRESCENT };
struct UiShape { uint8_t kind; float x, y, a, b, c, d; uint16_t col; float alpha; float x0, y0, x1, y1; };
#define UI_SHAPES 64
static UiShape uiSh[UI_SHAPES];
static int uiShN = 0;
static void uiShClear() { uiShN = 0; }
// DISC x,y radius a | RING x,y radius a thickness b | SEG (x,y)-(a,b) half-width c | ARC x,y radius a thickness b from c to d degrees
// (0 = 3 o'clock, clockwise) | BOX centre x,y half-sizes a,b corner c | BOXRING the same, line d | CRESCENT disc x,y,a less disc (x+c,y+d) radius b
static void uiShAdd(int kind, float x, float y, float a, float b, float c, float d, uint16_t col, float alpha = 1.0f) {
  if (uiShN >= UI_SHAPES) return;
  UiShape &s = uiSh[uiShN++];
  s.kind = (uint8_t)kind; s.x = x; s.y = y; s.a = a; s.b = b; s.c = c; s.d = d; s.col = col; s.alpha = alpha;
  float r = 0;
  switch (kind) {
    case UI_SH_DISC: case UI_SH_CRESCENT: r = a; break;
    case UI_SH_RING: case UI_SH_ARC: r = a + b * 0.5f; break;
    case UI_SH_SEG:
      s.x0 = (x < a ? x : a) - c - 2; s.x1 = (x > a ? x : a) + c + 2; s.y0 = (y < b ? y : b) - c - 2; s.y1 = (y > b ? y : b) + c + 2;
      return;
    default: s.x0 = x - a - 2; s.x1 = x + a + 2; s.y0 = y - b - 2; s.y1 = y + b + 2; return;
  }
  s.x0 = x - r - 2; s.x1 = x + r + 2; s.y0 = y - r - 2; s.y1 = y + r + 2;
}
static inline float uiSdRBox(float px, float py, float hw, float hh, float r) {
  float qx = fabsf(px) - (hw - r), qy = fabsf(py) - (hh - r);
  float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  float in = qx > qy ? qx : qy; if (in > 0) in = 0;
  return sqrtf(ox * ox + oy * oy) + in - r;
}
static float uiShDist(const UiShape &s, float px, float py) {
  switch (s.kind) {
    case UI_SH_DISC: { float dx = px - s.x, dy = py - s.y; return sqrtf(dx * dx + dy * dy) - s.a; }
    case UI_SH_RING: { float dx = px - s.x, dy = py - s.y; return fabsf(sqrtf(dx * dx + dy * dy) - s.a) - s.b * 0.5f; }
    case UI_SH_SEG: {
      float ax = px - s.x, ay = py - s.y, ex = s.a - s.x, ey = s.b - s.y;
      float t = (ax * ex + ay * ey) / (ex * ex + ey * ey + 1e-6f);
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      float dx = ax - ex * t, dy = ay - ey * t;
      return sqrtf(dx * dx + dy * dy) - s.c;
    }
    case UI_SH_ARC: {
      float dx = px - s.x, dy = py - s.y, len = sqrtf(dx * dx + dy * dy);
      float ang = atan2f(dy, dx) * 57.29578f;
      float span = s.d - s.c; while (span <= 0) span += 360.0f; while (span > 360.0f) span -= 360.0f;
      float rel = ang - s.c; while (rel < 0) rel += 360.0f; while (rel >= 360.0f) rel -= 360.0f;
      if (rel <= span) return fabsf(len - s.a) - s.b * 0.5f;
      float a0 = s.c * 0.0174533f, a1 = (s.c + span) * 0.0174533f;
      float e0x = s.x + s.a * cosf(a0) - px, e0y = s.y + s.a * sinf(a0) - py, e1x = s.x + s.a * cosf(a1) - px, e1y = s.y + s.a * sinf(a1) - py;
      float d0 = sqrtf(e0x * e0x + e0y * e0y), d1 = sqrtf(e1x * e1x + e1y * e1y);
      return (d0 < d1 ? d0 : d1) - s.b * 0.5f;
    }
    case UI_SH_BOX: return uiSdRBox(px - s.x, py - s.y, s.a, s.b, s.c);
    case UI_SH_BOXRING: return fabsf(uiSdRBox(px - s.x, py - s.y, s.a - s.d * 0.5f, s.b - s.d * 0.5f, s.c)) - s.d * 0.5f;
    case UI_SH_CRESCENT: {
      float dx = px - s.x, dy = py - s.y, d1 = sqrtf(dx * dx + dy * dy) - s.a;
      float ex = px - (s.x + s.c), ey = py - (s.y + s.d), d2 = sqrtf(ex * ex + ey * ey) - s.b;
      return d1 > -d2 ? d1 : -d2;
    }
  }
  return 1e9f;
}
// Paints the box (x, y, w, h) with the shapes added so far, over `bg`.
static void uiShPaint(int x, int y, int w, int h, uint16_t bg = UI_BLACK) {
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  x &= ~1; y &= ~1; w = (w + 1) & ~1; h = (h + 1) & ~1;
  if (x + w > UI_W) w = (UI_W - x) & ~1;
  if (y + h > UI_H) h = (UI_H - y) & ~1;
  if (w <= 0 || h <= 0) return;
  int rowsPer = ((int)(sizeof(uiLine) / sizeof(uiLine[0])) / w) & ~1;
  if (rowsPer < 2) rowsPer = 2;
  const float bR = ((bg >> 11) & 31), bG = ((bg >> 5) & 63), bB = (bg & 31);
  for (int r0 = 0; r0 < h; r0 += rowsPer) {
    int rows = h - r0 < rowsPer ? h - r0 : rowsPer;
    for (int r = 0; r < rows; r++) {
      float py = y + r0 + r + 0.5f;
      for (int c = 0; c < w; c++) {
        float px = x + c + 0.5f;
        float R = bR, G = bG, B = bB;
        for (int i = 0; i < uiShN; i++) {
          const UiShape &s = uiSh[i];
          if (px < s.x0 || px > s.x1 || py < s.y0 || py > s.y1) continue;
          float cov = 0.5f - uiShDist(s, px, py);
          if (cov <= 0) continue;
          if (cov > 1) cov = 1;
          cov *= s.alpha;
          R += (((s.col >> 11) & 31) - R) * cov; G += (((s.col >> 5) & 63) - G) * cov; B += ((s.col & 31) - B) * cov;
        }
        uiLine[r * w + c] = (uint16_t)(((int)(R + 0.5f) << 11) | ((int)(G + 0.5f) << 5) | (int)(B + 0.5f));
      }
    }
    uiOut.blit(x, y + r0, w, rows, uiLine);
  }
}
// The box the shapes added so far cover (for painting just them).
static void uiShBounds(int *x, int *y, int *w, int *h) {
  float x0 = 1e9f, y0 = 1e9f, x1 = -1e9f, y1 = -1e9f;
  for (int i = 0; i < uiShN; i++) {
    if (uiSh[i].x0 < x0) x0 = uiSh[i].x0;
    if (uiSh[i].y0 < y0) y0 = uiSh[i].y0;
    if (uiSh[i].x1 > x1) x1 = uiSh[i].x1;
    if (uiSh[i].y1 > y1) y1 = uiSh[i].y1;
  }
  *x = (int)x0; *y = (int)y0; *w = (int)(x1 - x0) + 2; *h = (int)(y1 - y0) + 2;
}
static void uiShPaintAll(uint16_t bg = UI_BLACK) { int x, y, w, h; uiShBounds(&x, &y, &w, &h); uiShPaint(x, y, w, h, bg); }

// ---- text that follows a circle: `top` true reads along the top of the circle (letters standing outward, like "SETTINGS" on the
// bezel), false along the bottom (letters standing inward, the bottom of a smile). Centred on the angle `mid` (degrees).
static int uiTrackedWidth(const NeddyFont &f, const char *s, int track) {
  int w = 0, n = 0;
  for (const char *p = s; *p; p++, n++) { int c = (uint8_t)*p; if (c < 32 || c > 127) c = '?'; w += f.adv[c - 32]; }
  return n ? w + track * (n - 1) : 0;
}
static void uiArcText(const NeddyFont &f, const char *s, float cx, float cy, float r, float mid, bool top, uint16_t fg, int track = 0, uint16_t bg = UI_BLACK) {
  int n = (int)strlen(s);
  if (n <= 0 || n > 40) return;
  float L = (float)uiTrackedWidth(f, s, track), half = L * 0.5f / r;     // radians either side of the middle
  float m = mid * 0.0174533f;
  struct G { int c, a; float gx, gy, tx, ty, rx, ry; } g[40];
  float x0 = 1e9f, y0 = 1e9f, x1 = -1e9f, y1 = -1e9f, run = 0;
  for (int i = 0; i < n; i++) {
    int c = (uint8_t)s[i]; if (c < 32 || c > 127) c = '?';
    int a = f.adv[c - 32];
    float along = (run + a * 0.5f) / r;                                  // the glyph's middle, as an angle from the start
    float th = top ? m - half + along : m + half - along;
    float erx = cosf(th), ery = sinf(th), etx = -ery, ety = erx;          // outward, and clockwise along the circle
    g[i].c = c; g[i].a = a; g[i].gx = cx + r * erx; g[i].gy = cy + r * ery;
    g[i].rx = erx; g[i].ry = ery; g[i].tx = top ? etx : -etx; g[i].ty = top ? ety : -ety;
    float ext = sqrtf((float)(a * a + f.h * f.h)) * 0.5f + 2;
    if (g[i].gx - ext < x0) x0 = g[i].gx - ext;
    if (g[i].gy - ext < y0) y0 = g[i].gy - ext;
    if (g[i].gx + ext > x1) x1 = g[i].gx + ext;
    if (g[i].gy + ext > y1) y1 = g[i].gy + ext;
    run += a + track;
  }
  int bx = ((int)x0) & ~1, by = ((int)y0) & ~1, bw = ((int)(x1 - bx) + 2) & ~1, bh = ((int)(y1 - by) + 2) & ~1;
  if (bx < 0) { bw += bx; bx = 0; }
  if (by < 0) { bh += by; by = 0; }
  if (bx + bw > UI_W) bw = (UI_W - bx) & ~1;
  if (by + bh > UI_H) bh = (UI_H - by) & ~1;
  if (bw <= 0 || bh <= 0) return;
  int rowsPer = ((int)(sizeof(uiLine) / sizeof(uiLine[0])) / bw) & ~1;
  if (rowsPer < 2) rowsPer = 2;
  for (int r0 = 0; r0 < bh; r0 += rowsPer) {
    int rows = bh - r0 < rowsPer ? bh - r0 : rowsPer;
    for (int rr = 0; rr < rows; rr++) {
      float py = by + r0 + rr + 0.5f;
      for (int c = 0; c < bw; c++) {
        float px = bx + c + 0.5f, cov = 0;
        for (int i = 0; i < n; i++) {
          float qx = px - g[i].gx, qy = py - g[i].gy;
          if (fabsf(qx) > 40 || fabsf(qy) > 40) continue;
          // glyph space: u along the advance, v down the glyph (v grows toward the centre on top, away from it at the bottom)
          float u = qx * g[i].tx + qy * g[i].ty + g[i].a * 0.5f;
          float v = (top ? -(qx * g[i].rx + qy * g[i].ry) : (qx * g[i].rx + qy * g[i].ry)) + f.h * 0.5f;
          if (u < -1 || v < -1 || u > g[i].a || v > f.h) continue;
          const uint8_t *bits = f.bits + f.off[g[i].c - 32];
          int iu = (int)floorf(u - 0.5f), iv = (int)floorf(v - 0.5f);
          float fu = u - 0.5f - iu, fv = v - 0.5f - iv;
          float s4 = 0;
          for (int k = 0; k < 4; k++) {
            int uu = iu + (k & 1), vv = iv + (k >> 1);
            if (uu < 0 || vv < 0 || uu >= g[i].a || vv >= f.h) continue;
            float w = ((k & 1) ? fu : 1 - fu) * ((k >> 1) ? fv : 1 - fv);
            s4 += bits[vv * g[i].a + uu] * w;
          }
          float a = s4 / 255.0f;
          if (a > cov) cov = a;
        }
        uiLine[rr * bw + c] = uiBlend(bg, fg, cov);
      }
    }
    uiOut.blit(bx, by + r0, bw, rows, uiLine);
  }
}

// Straight text with extra room between the letters (labels in capitals, like "BRIGHTNESS"). Centred on cx.
static void uiTrackedCentered(const NeddyFont &f, int cx, int y, const char *s, uint16_t fg, int track, uint16_t bg = UI_BLACK) {
  int n = (int)strlen(s);
  if (n <= 0) return;
  int w = (uiTrackedWidth(f, s, track) + 1) & ~1;
  if (w > UI_W) w = UI_W;
  int x = (cx - w / 2) & ~1;
  if (x < 0) x = 0;
  if (x + w > UI_W) w = (UI_W - x) & ~1;
  int hEven = (f.h + 1) & ~1;
  int rowsPer = ((int)(sizeof(uiLine) / sizeof(uiLine[0])) / w) & ~1;
  if (rowsPer > hEven) rowsPer = hEven;
  for (int r0 = 0; r0 < hEven; r0 += rowsPer) {
    int rows = hEven - r0 < rowsPer ? hEven - r0 : rowsPer;
    for (int i = 0; i < w * rows; i++) uiLine[i] = bg;
    int px = 0;
    for (const char *p = s; *p && px < w; p++) {
      int c = (uint8_t)*p; if (c < 32 || c > 127) c = '?';
      int a = f.adv[c - 32];
      const uint8_t *g = f.bits + f.off[c - 32];
      for (int row = r0; row < r0 + rows && row < f.h; row++)
        for (int col = 0; col < a && px + col < w; col++) {
          int al = g[row * a + col];
          if (al) uiLine[(row - r0) * w + px + col] = uiBlend(bg, fg, al / 255.0f);
        }
      px += a + track;
    }
    uiOut.blit(x, (y & ~1) + r0, w, rows, uiLine);
  }
}

// ---- line icons, drawn from shapes so they stay crisp at any size. `s` is the icon's size in pixels (its box), centred on cx, cy.
enum { UI_IC_MIC, UI_IC_BULB, UI_IC_PEOPLE, UI_IC_MOON, UI_IC_CLOCK, UI_IC_SLIDERS, UI_IC_INFO, UI_IC_POWER, UI_IC_SUN, UI_IC_RESTART,
       UI_IC_CHAT, UI_IC_NONE, UI_IC_BARS1, UI_IC_BARS2, UI_IC_BARS3, UI_IC_CHECK, UI_IC_CLOUDSUN, UI_IC_CALENDAR, UI_IC_SCREENOFF };
static void uiIconAdd(int id, float cx, float cy, float s, uint16_t col) {
  const float k = s / 100.0f, w = 7.0f * k;                 // designed on a 100 x 100 grid, lines 7 wide
#define P(x, y) cx + ((x) - 50) * k, cy + ((y) - 50) * k
  switch (id) {
    case UI_IC_MIC:
      uiShAdd(UI_SH_SEG, P(50, 26), P(50, 48), 15 * k, 0, col);                      // the head: a capsule
      uiShAdd(UI_SH_ARC, P(50, 48), 25 * k, w, 0, 180, col);                          // the cup under it
      uiShAdd(UI_SH_SEG, P(50, 73), P(50, 85), w * 0.5f, 0, col);                     // the stem
      uiShAdd(UI_SH_SEG, P(36, 87), P(64, 87), w * 0.5f, 0, col);                     // the foot
      break;
    case UI_IC_BULB:
      uiShAdd(UI_SH_ARC, P(50, 46), 19 * k, w, 135, 405, col);                        // the glass
      uiShAdd(UI_SH_SEG, P(37, 60), P(41, 70), w * 0.5f, 0, col);
      uiShAdd(UI_SH_SEG, P(63, 60), P(59, 70), w * 0.5f, 0, col);
      uiShAdd(UI_SH_SEG, P(41, 74), P(59, 74), w * 0.5f, 0, col);                     // the screw base
      uiShAdd(UI_SH_SEG, P(43, 82), P(57, 82), w * 0.5f, 0, col);
      for (int i = 0; i < 5; i++) {                                                     // the rays
        float a = (-180 + 45 * i) * 0.0174533f;
        uiShAdd(UI_SH_SEG, cx + cosf(a) * 31 * k, cy - 4 * k + sinf(a) * 31 * k, cx + cosf(a) * 40 * k, cy - 4 * k + sinf(a) * 40 * k, w * 0.5f, 0, col);
      }
      break;
    case UI_IC_PEOPLE:
      uiShAdd(UI_SH_DISC, P(50, 36), 10 * k, 0, 0, 0, col);
      uiShAdd(UI_SH_DISC, P(26, 40), 8 * k, 0, 0, 0, col);
      uiShAdd(UI_SH_DISC, P(74, 40), 8 * k, 0, 0, 0, col);
      uiShAdd(UI_SH_ARC, P(50, 74), 18 * k, w, 200, 340, col);
      uiShAdd(UI_SH_ARC, P(24, 72), 14 * k, w, 205, 300, col);
      uiShAdd(UI_SH_ARC, P(76, 72), 14 * k, w, 240, 335, col);
      break;
    case UI_IC_MOON:
      uiShAdd(UI_SH_CRESCENT, P(46, 54), 30 * k, 24 * k, 14 * k, -12 * k, col);
      uiShAdd(UI_SH_SEG, P(74, 20), P(74, 34), 2.5f * k, 0, col);                     // a small star
      uiShAdd(UI_SH_SEG, P(67, 27), P(81, 27), 2.5f * k, 0, col);
      break;
    case UI_IC_CLOCK:
      uiShAdd(UI_SH_RING, P(50, 50), 33 * k, w, 0, 0, col);
      uiShAdd(UI_SH_SEG, P(50, 50), P(50, 30), w * 0.5f, 0, col);
      uiShAdd(UI_SH_SEG, P(50, 50), P(64, 50), w * 0.5f, 0, col);
      break;
    case UI_IC_SLIDERS:
      uiShAdd(UI_SH_SEG, P(20, 38), P(80, 38), w * 0.5f, 0, col);
      uiShAdd(UI_SH_SEG, P(20, 62), P(80, 62), w * 0.5f, 0, col);
      uiShAdd(UI_SH_DISC, P(62, 38), 9 * k, 0, 0, 0, col);
      uiShAdd(UI_SH_DISC, P(38, 62), 9 * k, 0, 0, 0, col);
      break;
    case UI_IC_INFO:
      uiShAdd(UI_SH_RING, P(50, 50), 33 * k, w, 0, 0, col);
      uiShAdd(UI_SH_DISC, P(50, 34), 5 * k, 0, 0, 0, col);
      uiShAdd(UI_SH_SEG, P(50, 46), P(50, 66), w * 0.55f, 0, col);
      break;
    case UI_IC_POWER:
      uiShAdd(UI_SH_ARC, P(50, 54), 28 * k, w, -50, 230, col);
      uiShAdd(UI_SH_SEG, P(50, 18), P(50, 48), w * 0.5f, 0, col);
      break;
    case UI_IC_SUN:
      uiShAdd(UI_SH_RING, P(50, 50), 15 * k, w, 0, 0, col);
      for (int i = 0; i < 8; i++) {
        float a = i * 0.785398f;
        uiShAdd(UI_SH_SEG, cx + cosf(a) * 27 * k, cy + sinf(a) * 27 * k, cx + cosf(a) * 36 * k, cy + sinf(a) * 36 * k, w * 0.5f, 0, col);
      }
      break;
    case UI_IC_RESTART:
      uiShAdd(UI_SH_ARC, P(50, 52), 28 * k, w, -60, 240, col);
      uiShAdd(UI_SH_SEG, P(64, 28), P(76, 26), w * 0.5f, 0, col);                     // the arrow's head
      uiShAdd(UI_SH_SEG, P(64, 28), P(68, 40), w * 0.5f, 0, col);
      break;
    case UI_IC_CHAT:
      uiShAdd(UI_SH_BOXRING, P(50, 44), 32 * k, 22 * k, 12 * k, w, col);
      uiShAdd(UI_SH_SEG, P(36, 66), P(30, 80), w * 0.5f, 0, col);
      break;
    case UI_IC_NONE:
      uiShAdd(UI_SH_RING, P(50, 50), 28 * k, w, 0, 0, col);
      uiShAdd(UI_SH_SEG, P(31, 69), P(69, 31), w * 0.5f, 0, col);
      break;
    case UI_IC_BARS1: case UI_IC_BARS2: case UI_IC_BARS3: {
      int lit = id - UI_IC_BARS1 + 1;
      for (int b = 0; b < 3; b++) {
        float h = 18 + b * 16, bx = 28 + b * 22;
        uiShAdd(UI_SH_BOX, P(bx, 78 - h * 0.5f), 7 * k, h * 0.5f * k, 3 * k, 0, b < lit ? col : uiBlend(UI_BLACK, col, 0.3f));
      }
      break;
    }
    case UI_IC_CLOUDSUN:                                                               // the weather: a sun behind a cloud
      uiShAdd(UI_SH_ARC, P(36, 40), 13 * k, w, 150, 330, col);
      for (int i = 0; i < 4; i++) {
        float a = (-170 + 40 * i) * 0.0174533f;
        uiShAdd(UI_SH_SEG, cx + (-14 + cosf(a) * 21) * k, cy + (-10 + sinf(a) * 21) * k, cx + (-14 + cosf(a) * 28) * k, cy + (-10 + sinf(a) * 28) * k, w * 0.45f, 0, col);
      }
      uiShAdd(UI_SH_ARC, P(48, 56), 15 * k, w, 180, 300, col);                        // the cloud's bumps
      uiShAdd(UI_SH_ARC, P(66, 54), 13 * k, w, 220, 360, col);
      uiShAdd(UI_SH_ARC, P(30, 66), 9 * k, w, 90, 270, col);
      uiShAdd(UI_SH_ARC, P(74, 66), 9 * k, w, 270, 450, col);
      uiShAdd(UI_SH_SEG, P(30, 75), P(74, 75), w * 0.5f, 0, col);                     // its flat bottom
      break;
    case UI_IC_CALENDAR:
      uiShAdd(UI_SH_BOXRING, P(50, 54), 32 * k, 28 * k, 6 * k, w, col);
      uiShAdd(UI_SH_SEG, P(20, 38), P(80, 38), w * 0.5f, 0, col);
      uiShAdd(UI_SH_SEG, P(36, 18), P(36, 30), w * 0.5f, 0, col);
      uiShAdd(UI_SH_SEG, P(64, 18), P(64, 30), w * 0.5f, 0, col);
      uiShAdd(UI_SH_DISC, P(50, 60), 7 * k, 0, 0, 0, col);
      break;
    case UI_IC_SCREENOFF:                                                              // a screen with a line through it
      uiShAdd(UI_SH_BOXRING, P(50, 50), 26 * k, 32 * k, 9 * k, w, col);
      uiShAdd(UI_SH_SEG, P(22, 20), P(78, 80), w * 0.5f, 0, col);
      break;
    case UI_IC_CHECK:
      uiShAdd(UI_SH_SEG, P(28, 52), P(44, 68), w * 0.6f, 0, col);
      uiShAdd(UI_SH_SEG, P(44, 68), P(74, 34), w * 0.6f, 0, col);
      break;
  }
#undef P
}
// One icon on its own: painted in its box over `bg`.
static void uiIcon(int id, int cx, int cy, int s, uint16_t col, uint16_t bg = UI_BLACK) {
  uiShClear();
  uiIconAdd(id, (float)cx, (float)cy, (float)s, col);
  uiShPaint(cx - s / 2 - 2, cy - s / 2 - 2, s + 4, s + 4, bg);
}
// A battery: outline, knob and a fill for the level (red when low, green while charging), cx/cy its middle, w its width.
static void uiBatteryAdd(float cx, float cy, float w, int pct, bool charging, uint16_t col) {
  float h = w * 0.5f, t = w * 0.07f;
  uiShAdd(UI_SH_BOXRING, cx - t, cy, w * 0.5f - t, h * 0.5f, h * 0.22f, t, col);
  uiShAdd(UI_SH_BOX, cx + w * 0.5f - t * 0.2f, cy, t, h * 0.2f, t * 0.6f, 0, col);
  if (pct > 0) {
    float in = w - 2 * t - 3.2f * t, fw = in * (pct > 100 ? 100 : pct) / 100.0f;
    uint16_t fc = charging ? uiRgb(104, 222, 146) : (pct <= 15 ? UI_REC_RED : col);
    uiShAdd(UI_SH_BOX, cx - t - (w * 0.5f - t) + 1.6f * t + fw * 0.5f + t * 0.4f, cy, fw * 0.5f, h * 0.5f - 2.4f * t, h * 0.1f, 0, fc);
  }
}

// ---- page dots: which page of several this is. Round: along an arc under the top edge (or down the right edge for
// pages that go up and down). Rectangle: a straight row (or column).
static void uiPageDotsAdd(int n, int at, bool vertical) {
  const uint16_t off = uiBlend(UI_BLACK, UI_LABEL, 0.4f), on = uiAcc();
#if NEDDY_ROUND
  float r = vertical ? UI_W * 0.5f - 24 : UI_W * 0.5f - 74, step = vertical ? 7.0f : 5.2f, mid = vertical ? 0.0f : -90.0f;
  for (int i = 0; i < n; i++) {
    float a = (mid + (i - (n - 1) * 0.5f) * step) * 0.0174533f;
    uiShAdd(UI_SH_DISC, UI_CX + r * cosf(a), UI_CY + r * sinf(a), i == at ? 6.5f : 4.0f, 0, 0, 0, i == at ? on : off);
  }
#else
  for (int i = 0; i < n; i++) {
    float o = (i - (n - 1) * 0.5f) * (vertical ? 26.0f : 24.0f);
    float x = vertical ? UI_W - 22.0f : UI_CX + o, y = vertical ? UI_CY + o : 74.0f;
    uiShAdd(UI_SH_DISC, x, y, i == at ? 6.5f : 4.0f, 0, 0, 0, i == at ? on : off);
  }
#endif
}

// A title along the top: curved under the bezel on the round screen, straight on the rectangle.
static void uiTopTitle(const char *s, uint16_t col) {
#if NEDDY_ROUND
  uiArcText(NFONT_MID, s, UI_CX, UI_CY, UI_W * 0.5f - 36, -90, true, col, 6);
#else
  uiTrackedCentered(NFONT_MID, UI_CX, 22, s, col, 6);
#endif
}
// A line along the bottom: curved over the bottom edge on the round screen, straight on the rectangle.
static void uiBottomLine(const char *s, uint16_t col) {
#if NEDDY_ROUND
  uiArcText(NFONT_MID, s, UI_CX, UI_CY, UI_W * 0.5f - 40, 90, false, col, 4);
#else
  uiTrackedCentered(NFONT_MID, UI_CX, UI_H - 54, s, col, 4);
#endif
}
