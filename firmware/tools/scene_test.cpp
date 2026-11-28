// Tests Neddy's animated scenes on a computer with the watch's own decoder (neddy_scene.h + neddy_jpg.c): every frame of every
// scene decodes at the right size, the corners are the screen's true black (the fades worked), each loop joins up (its last frame
// is close to its first), and how long a frame takes. Writes the first frame of each scene as sc_<name>.ppm. Build and run:
//   gcc -O2 -c firmware/neddy_device/neddy_jpg.c -o /tmp/njpg.o && g++ -O2 -std=c++17 -I firmware/neddy_device \
//     firmware/tools/scene_test.cpp /tmp/njpg.o -o /tmp/scene_test && /tmp/scene_test /tmp
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include "neddy_scene.h"

static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

static void savePpm(const char *path, const uint16_t *px) {
  FILE *f = fopen(path, "wb");
  if (!f) return;
  fprintf(f, "P6\n%d %d\n255\n", SC_W, SC_H);
  for (int i = 0; i < SC_W * SC_H; i++) {
    uint16_t c = px[i];
    unsigned char rgb[3] = { (unsigned char)((c >> 8) & 0xF8), (unsigned char)((c >> 3) & 0xFC), (unsigned char)((c << 3) & 0xF8) };
    fwrite(rgb, 1, 3, f);
  }
  fclose(f);
}
static int chan(uint16_t c, int k) { return k == 0 ? (c >> 11) << 3 : k == 1 ? ((c >> 5) & 63) << 2 : (c & 31) << 3; }

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : ".";
  static uint16_t a[SC_W * SC_H], b[SC_W * SC_H];
  double worst = 0, total = 0; int n = 0;
  for (int s = 0; s < SC_COUNT; s++) {
    const ScClip &c = SC_CLIPS[s];
    bool all = true, black = true;
    for (int k = 0; k < c.count; k++) {
      uint32_t ms = (uint32_t)((k * 1000 + 500) / SC_FPS);       // the middle of frame k
      auto t0 = std::chrono::steady_clock::now();
      bool ok = scDecode(s, ms, a);
      double dt = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      total += dt; n++; if (dt > worst) worst = dt;
      if (!ok) all = false;
      if (a[0] || a[SC_W - 1] || a[(SC_H - 1) * SC_W] || a[SC_H * SC_W - 1]) black = false;
      if (k == 0) { char p[256]; snprintf(p, sizeof p, "%s/sc_%s.ppm", dir, c.name); savePpm(p, a); }
    }
    char what[96];
    snprintf(what, sizeof what, "%s: every frame decodes", c.name); CHECK(all, what);
    snprintf(what, sizeof what, "%s: the corners are true black", c.name); CHECK(black, what);
    // the loop joins up: the last frame is close to the first (the clips start and end on the same picture)
    scDecode(s, (uint32_t)((0 * 1000 + 500) / SC_FPS), a);
    scDecode(s, (uint32_t)(((c.count - 1) * 1000 + 500) / SC_FPS), b);
    long diff = 0;
    for (int i = 0; i < SC_W * SC_H; i++) for (int k = 0; k < 3; k++) diff += abs(chan(a[i], k) - chan(b[i], k));
    double mean = (double)diff / (SC_W * SC_H * 3);
    printf("%-9s %2d frames, last vs first: %.1f\n", c.name, c.count, mean);
    snprintf(what, sizeof what, "%s: the loop joins up (last frame close to the first)", c.name); CHECK(mean < 12, what);
    // the loop wraps round: a whole loop later (in frames) is the same picture
    scDecode(s, 500 / SC_FPS, a); scDecode(s, (uint32_t)(((uint64_t)c.count * 1000 + 500) / SC_FPS), b);
    snprintf(what, sizeof what, "%s: a whole loop later is the same frame", c.name); CHECK(memcmp(a, b, sizeof a) == 0, what);
  }
  CHECK(!scDecode(-1, 0, a) && !scDecode(SC_COUNT, 0, a), "a scene that doesn't exist decodes nothing");
  printf("decode: %.2f ms a frame on average, %.2f ms at worst (this computer)\n", total / n, worst);
  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures ? 1 : 0;
}
