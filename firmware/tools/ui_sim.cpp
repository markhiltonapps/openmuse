// A test of the watch's screen on a computer: builds neddy_ui.h as it is, draws scenes into a picture of the
// screen, and writes them as .ppm files. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/ui_sim.cpp -o /tmp/ui_sim && /tmp/ui_sim /tmp/frames
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include "neddy_ui.h"

static uint16_t fb[UI_W * UI_H];
static long blits = 0, blitPixels = 0;

static void simBlit(int x, int y, int w, int h, uint16_t *px) {
  blits++; blitPixels += (long)w * h;
  for (int r = 0; r < h; r++) {
    if (y + r < 0 || y + r >= UI_H) continue;
    for (int c = 0; c < w; c++) if (x + c >= 0 && x + c < UI_W) fb[(y + r) * UI_W + x + c] = px[r * w + c];
  }
}
static void simFill(int x, int y, int w, int h, uint16_t col) {
  blits++; blitPixels += (long)w * h;
  for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) {
    int xx = x + c, yy = y + r;
    if (xx >= 0 && xx < UI_W && yy >= 0 && yy < UI_H) fb[yy * UI_W + xx] = col;
  }
}
static void save(const char *dir, const char *name) {
  std::string path = std::string(dir) + "/" + name + ".ppm";
  FILE *f = fopen(path.c_str(), "wb");
  fprintf(f, "P6\n%d %d\n255\n", UI_W, UI_H);
  for (int i = 0; i < UI_W * UI_H; i++) {
    uint16_t c = fb[i];
    unsigned char rgb[3] = { (unsigned char)(((c >> 11) & 31) * 255 / 31), (unsigned char)(((c >> 5) & 63) * 255 / 63), (unsigned char)((c & 31) * 255 / 31) };
    fwrite(rgb, 1, 3, f);
  }
  fclose(f);
}
static double now() { return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : ".";
  uiOut.blit = simBlit; uiOut.fill = simFill;
  uiSetDiag("Wi-Fi -47 dBm  mic ok  drops 0  start 1", "answer 0.9 s  sent 4820 ms  peak 4605");
  uiSetName("Phone");
  uint32_t t = 1000;
  // 1. ready, still (blinking only)
  uiMotion = false; uiMode = UI_READY; uiAll = true; uiNextBlink = 999999;
  uiTick(t); save(dir, "s1_ready_still");
  // 1b. a blink
  uiNextBlink = 0; uiTick(t + 10); save(dir, "s1b_blink");
  uiNextBlink = 999999; uiBlinkUntil = 0;
  // 2. listening
  uiSetMode(UI_LISTEN); uiSetLevel(0.62f); uiTick(t + 20); save(dir, "s2_listen");
  // 3. thinking with what he heard
  uiSetMode(UI_THINK); uiSetHeard("What time is it in California?"); uiTick(t + 30); save(dir, "s3_think");
  // 4. speaking
  uiSetMode(UI_SPEAK); uiSetWords("Roughly 1,600 miles from New York to Houston, about a 24-hour drive or a three-hour flight.");
  uiTick(t + 40); save(dir, "s4_speak");
  // 5. back to ready, with words kept
  uiSetMode(UI_READY); uiTick(t + 50); save(dir, "s5_ready_words");
  // 6. connecting
  uiSetMode(UI_LINK); uiSetWords(""); uiSetHeard(""); uiTick(t + 60); save(dir, "s6_link");
  // 7. motion: ready (big) at several moments, and small with words
  uiMotion = true; uiSetMode(UI_READY); uiNextBlink = 999999; uiNextGlance = 999999;
  uiTick(2000); 
  const uint32_t times[] = { 2000, 2700, 3400, 4100, 4800 };
  for (int i = 0; i < 5; i++) { uiTick(times[i]); char nm[40]; snprintf(nm, sizeof nm, "m1_big_%d", i); save(dir, nm); }
  uiSetMode(UI_SPEAK); uiSetWords("It's about 5:45 PM in California, three hours behind you.");
  uiTick(5000);
  for (int i = 0; i < 5; i++) { uiTick(5100 + i * 90); char nm[40]; snprintf(nm, sizeof nm, "m2_small_%d", i); save(dir, nm); }
  // timing of one frame (host speed, not the watch's)
  UiPose p; uiPoseNow(7000, &p);
  double t0 = now(); for (int i = 0; i < 20; i++) uiRenderStage(p, uiStageX, uiStageY, uiStageW, uiStageH);
  printf("small-layout stage %dx%d: %.2f ms per frame on this computer\n", uiStageW, uiStageH, (now() - t0) / 20);
  uiSmall = false; UiPose big; uiBasePose(&big); int bx, by, bw, bh; uiStageRect(big, &bx, &by, &bw, &bh);
  t0 = now(); for (int i = 0; i < 20; i++) uiRenderStage(big, bx, by, bw, bh);
  printf("big-layout stage %dx%d: %.2f ms per frame on this computer\n", bw, bh, (now() - t0) / 20);
  return 0;
}
