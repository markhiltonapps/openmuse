// Tests of the round screen's last step (neddy_frame.h, the same code the watch runs): turning the picture, the button
// marks, touches and the auto-rotate decision. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/frame_test.cpp -o /tmp/frame_test && /tmp/frame_test
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include "neddy_font.h"
#include "neddy_frame.h"

static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

static const int S = FR_SIZE;
static std::vector<uint16_t> glass(S * S);
static int oddWindows = 0, outside = 0;
static void hwBlit(int x, int y, int w, int h, uint16_t *px) {
  if ((x | y | w | h) & 1) oddWindows++;
  if (x < 0 || y < 0 || x + w > S || y + h > S) { outside++; return; }
  for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) glass[(y + r) * S + x + c] = px[r * w + c];
}
static void hwFill(int x, int y, int w, int h, uint16_t col) {
  if ((x | y | w | h) & 1) oddWindows++;
  if (x < 0 || y < 0 || x + w > S || y + h > S) { outside++; return; }
  for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) glass[(y + r) * S + x + c] = col;
}
static void *alloc(size_t n) { return malloc(n); }

static uint16_t pattern(int x, int y) { return (uint16_t)((x * 7 + y * 13) & 0xFFFF) | 1; }   // never black

// Draws the whole upright picture as a mix of blits and fills, with the given turn.
static std::vector<uint16_t> logical(S * S);
static void drawPicture() {
  for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) logical[y * S + x] = pattern(x, y);
  logical.assign(logical.size(), 0);
  for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) logical[y * S + x] = pattern(x, y);
  std::vector<uint16_t> tile;
  for (int y = 0; y < S; y += 32)
    for (int x = 0; x < S; x += 40) {
      int w = x + 40 > S ? S - x : 40, h = y + 32 > S ? S - y : 32;
      tile.resize(w * h);
      for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) tile[r * w + c] = logical[(y + r) * S + x + c];
      frBlit(x, y, w, h, tile.data());
    }
}

static void showMarks(bool on) {
  frMarks[0].on = on; frMarks[0].angle = 120; frMarks[0].colour = 0xFE00; snprintf(frMarks[0].word, 8, "TALK");
  frMarks[1].on = on; frMarks[1].angle = 30; frMarks[1].colour = 0xFFFF; snprintf(frMarks[1].word, 8, "MENU");
  for (int i = 0; i < FR_MARKS; i++) if (frMarks[i].on) frBuildMark(frMarks[i], NFONT_SMALL.h, NFONT_SMALL.adv, NFONT_SMALL.off, NFONT_SMALL.bits);
}
// The angle (clockwise from 12, on the glass) of the centre of the pixels of one colour near the rim.
static double rimAngleOf(uint16_t col, int *count) {
  double sx = 0, sy = 0; int n = 0;
  for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) {
    double dx = x + 0.5 - S / 2.0, dy = y + 0.5 - S / 2.0;
    if (glass[y * S + x] == col && sqrt(dx * dx + dy * dy) > FR_RIM_R - 6) { sx += dx; sy += dy; n++; }
  }
  *count = n;
  double a = atan2(sx, -sy) * 180.0 / 3.14159265;
  return a < 0 ? a + 360 : a;
}
static double angleGap(double a, double b) { double d = fabs(a - b); return d > 180 ? 360 - d : d; }

int main() {
  frHwBlit = hwBlit; frHwFill = hwFill;
  CHECK(frInit(alloc), "mask memory found");

  // Coordinates: every turn maps a point and back to itself, and windows land inside the glass.
  bool round = true, inside = true;
  for (int rot = 0; rot < 4; rot++) {
    for (int i = 0; i < 2000; i++) {
      int x = rand() % S, y = rand() % S, gx, gy, lx, ly;
      frToGlass(rot, x, y, &gx, &gy); frToUpright(rot, gx, gy, &lx, &ly);
      if (lx != x || ly != y) round = false;
      int rx = (rand() % (S / 2)) & ~1, ry = (rand() % (S / 2)) & ~1, rw = 2 + ((rand() % 100) & ~1), rh = 2 + ((rand() % 100) & ~1);
      int px, py, pw, ph; frPhysRect(rot, rx, ry, rw, rh, &px, &py, &pw, &ph);
      frToGlass(rot, x % rw + rx, y % rh + ry, &gx, &gy);
      if (gx < px || gy < py || gx >= px + pw || gy >= py + ph) inside = false;
    }
  }
  CHECK(round, "glass -> upright -> glass is the same point for every turn");
  CHECK(inside, "every point of a window lands inside that window on the glass");
  CHECK(frScreenAngle(30, 0) == 30 && frScreenAngle(30, 1) == 300 && frScreenAngle(120, 2) == 300 && frScreenAngle(120, 3) == 210, "a button's angle in the picture follows the turn");

  // The picture, turned: what the UI drew at (x, y) is on the glass where frToGlass says, for every pixel.
  for (int rot = 0; rot < 4; rot++) {
    frRot = rot; showMarks(false);
    drawPicture();
    int wrong = 0;
    for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) { int gx, gy; frToGlass(rot, x, y, &gx, &gy); if (glass[gy * S + gx] != logical[y * S + x]) wrong++; }
    char what[80]; snprintf(what, sizeof what, "turn %d: every pixel of the picture is in its place", rot);
    CHECK(wrong == 0, what);
    hwFill(0, 0, S, S, 0);
    frFill(100, 40, 60, 20, 0x1234);
    int gx, gy; frToGlass(rot, 101, 41, &gx, &gy);
    snprintf(what, sizeof what, "turn %d: a fill lands where it should", rot);
    CHECK(glass[gy * S + gx] == 0x1234, what);
  }
  CHECK(oddWindows == 0, "no odd window ever reached the screen");
  CHECK(outside == 0, "no window reached past the glass");

  // The marks: next to the real buttons whatever the turn, on top of anything drawn, inside the circle.
  for (int rot = 0; rot < 4; rot++) {
    frRot = rot; showMarks(true);
    frFill(0, 0, S, S, 0x0000);                     // a full redraw: black, then a busy band right across the small button's corner
    std::vector<uint16_t> band(S * 40, 0x07E0);
    int ly = frMarks[0].text.y - 10; if (ly < 0) ly = 0; ly &= ~1;
    frBlit(0, ly, S, 40, band.data());
    int nTalk = 0, nMenu = 0;
    double aTalk = rimAngleOf(0xFE00, &nTalk), aMenu = rimAngleOf(0xFFFF, &nMenu);
    char what[100];
    snprintf(what, sizeof what, "turn %d: the TALK arc is on the glass next to the small button (4 o'clock): %.0f deg, %d px", rot, aTalk, nTalk);
    CHECK(nTalk > 150 && angleGap(aTalk, 120) < 6, what);
    snprintf(what, sizeof what, "turn %d: the MENU arc is next to the big button (1 o'clock): %.0f deg, %d px", rot, aMenu, nMenu);
    CHECK(nMenu > 150 && angleGap(aMenu, 30) < 6, what);
    int words = 0, outsideCircle = 0;
    for (int i = 0; i < FR_MARKS; i++) {
      const FrLayer &t = frMarks[i].text;
      for (int y = 0; y < t.h; y++) for (int x = 0; x < t.w; x++) if (t.a[y * t.w + x] > 128) {
        words++;
        double dx = t.x + x + 0.5 - S / 2.0, dy = t.y + y + 0.5 - S / 2.0;
        if (sqrt(dx * dx + dy * dy) > FR_RIM_R - FR_ARC_T) outsideCircle++;
      }
    }
    snprintf(what, sizeof what, "turn %d: both words are drawn and stay inside the arc's circle", rot);
    CHECK(words > 60 && outsideCircle == 0, what);
  }
  // A mark's word is level on the glass in every turn? It is level in the picture; the picture turns with the watch, so
  // it reads level to the person. And with the marks off, nothing of them is left after a redraw.
  frRot = 0; showMarks(false);
  frFill(0, 0, S, S, 0);
  int left = 0; for (auto c : glass) if (c) left++;
  CHECK(left == 0, "marks turned off: a redraw leaves nothing of them");

  // Which way up.
  {
    FrOrient o; frOrientReset(o);
    int k = 0; uint32_t t = 1000;
    for (int i = 0; i < 30; i++, t += 33) k = frOrientFeed(o, k, t, 0, 1000, 100);
    CHECK(k == 0, "upright stays upright");
    for (int i = 0; i < 9; i++, t += 33) k = frOrientFeed(o, k, t, 950, 0, 200);   // 300 ms on its side
    for (int i = 0; i < 30; i++, t += 33) k = frOrientFeed(o, k, t, 0, 1000, 100);
    CHECK(k == 0, "a brief tilt (300 ms) doesn't turn it");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, 1000, 0, 30);   // arm hanging down, glass upright
    CHECK(k == 0, "arm hanging down (the glass upright, gravity across it): no turn");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, -990, 60, -80);
    CHECK(k == 0, "lying on your side, watch in front of your face: no turn");
    for (int i = 0; i < 20; i++, t += 33) k = frOrientFeed(o, k, t, 800, 0, 400);   // held turned in the hand, glass tilted back, 660 ms
    CHECK(k == 3, "held turned with the glass tilted back toward you for half a second: a quarter turn");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, 100, 80, 990);
    CHECK(k == 3, "laid flat: keeps the turn it had");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, 700, 700, 100);
    CHECK(k == 3, "halfway between two sides: no change");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, 0, 1800, 0);
    CHECK(k == 3, "shaken (far from 1 g): no change");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, 0, -900, 400);
    CHECK(k == 2, "upside down: half a turn");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, -900, 0, 400);
    CHECK(k == 1, "gravity to the left: three quarters the other way");
    for (int i = 0; i < 40; i++, t += 33) k = frOrientFeed(o, k, t, 0, 900, 400);
    CHECK(k == 0, "back upright");
  }

  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures ? 1 : 0;
}
