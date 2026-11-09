// A test of the watch's screen on a computer: builds neddy_ui.h as it is, draws scenes into a picture of the
// screen, and writes them as .ppm files. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/ui_sim.cpp -o /tmp/ui_sim && /tmp/ui_sim /tmp/frames
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include "neddy_ui.h"

static uint16_t fb[UI_W * UI_H];
static long blits = 0, blitPixels = 0, oddWindows = 0;
static void checkEven(const char *what, int x, int y, int w, int h) {
  if ((x | y | w | h) & 1) { oddWindows++; fprintf(stderr, "ODD %s window x=%d y=%d w=%d h=%d\n", what, x, y, w, h); }
}

static void simBlit(int x, int y, int w, int h, uint16_t *px) {
  checkEven("blit", x, y, w, h);
  blits++; blitPixels += (long)w * h;
  for (int r = 0; r < h; r++) {
    if (y + r < 0 || y + r >= UI_H) continue;
    for (int c = 0; c < w; c++) if (x + c >= 0 && x + c < UI_W) fb[(y + r) * UI_W + x + c] = px[r * w + c];
  }
}
static void simFill(int x, int y, int w, int h, uint16_t col) {
  checkEven("fill", x, y, w, h);
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
#define CHECK_IDLE(cond, what) do { if (!(cond)) { printf("IDLE CHECK FAILED: %s\n", what); } } while (0)
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
  // 5b. a long answer (shows the newest lines that fit)
  uiSetMode(UI_SPEAK); uiSetHeard("What is the population of New York City and how big is the metro area?");
  uiSetWords("New York City's population is about 8.3 million people, making it the largest city in the US. The greater metro area has over 20 million people, which makes it one of the biggest in the world. It is also the most densely populated major city in America.");
  uiTick(t + 55); save(dir, "s5b_long");
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
  // 8. weather cards (and every picture)
  uiMotion = false; uiNextBlink = 999999; uiSetMode(UI_READY); uiSetWords(""); uiSetHeard("");
  {
    uiOut.fill(0, 0, UI_W, UI_H, UI_BLACK);
    uint16_t panel = uiRgb(20, 28, 36);
    for (int i = 0; i < 11; i++) {
      uiRenderIcon(i, panel);
      uiOut.blit(6 + (i % 3) * 132, 4 + (i / 3) * 124, UI_ICON, UI_ICON, uiIconBuf);
    }
    save(dir, "c0_icons");
  }
  uint32_t tc = 20000;
  uiShowWeather(tc, "Houston", 72, UI_NONE, "Partly cloudy", UI_ICON_PARTLY, 80, 65, 30, ""); uiTick(tc); save(dir, "c1_partly");
  uiShowWeather(tc, "Houston", 96, 108, "Chance showers and thunderstorms", UI_ICON_STORM, 99, 77, 70, "Heat Advisory"); uiTick(tc); save(dir, "c2_storm_alert");
  uiShowWeather(tc, "Fargo", -12, -25, "Snow", UI_ICON_SNOW, -4, -18, 90, ""); uiTick(tc); save(dir, "c3_snow_negative");
  uiShowWeather(tc, "San Francisco", 58, 55, "Mostly clear", UI_ICON_MOON, UI_NONE, 52, 0, ""); uiTick(tc); save(dir, "c4_night_no_high");
  uiShowWeather(tc, "Houston", 104, 110, "Sunny", UI_ICON_SUN, 106, 84, 0, ""); uiTick(tc); save(dir, "c5_sun_three_digit");
  uiShowWeather(tc, "Chicago", 41, 34, "Light rain", UI_ICON_RAIN, 45, 36, 80, ""); uiMotion = true; uiTick(tc); uiTick(tc + 90); save(dir, "c6_rain_motion");
  uiMotion = false;
  // words that arrive while the card is up wait behind it; the next press (listening) clears it
  uiSetWords("It's 41 degrees and raining."); uiTick(tc + 300); save(dir, "c7_words_behind_card");
  uiSetMode(UI_LISTEN); uiTick(tc + 400); save(dir, "c8_cleared_by_press");
  uiSetMode(UI_READY); uiShowWeather(tc + 500, "Houston", 72, UI_NONE, "Sunny", UI_ICON_SUN, 80, 65, 0, ""); uiTick(tc + 500);
  uiTick(tc + 500 + UI_CARD_MS + 10); save(dir, "c9_timed_out");
  // 9. the other cards
  uiMotion = false; uiSetMode(UI_READY);
  uint32_t tg = 40000;
  uiShowScore(tg, "NBA", "Q3 4:21", "Lakers", 78, "Warriors", 81); uiTick(tg); save(dir, "g1_score_live");
  uiShowScore(tg, "NFL", "Final", "Chiefs", 27, "Golden State Wa.", 24); uiTick(tg); save(dir, "g2_score_final_leader_away");
  uiShowScore(tg, "MLB", "7:05 PM tonight", "Astros", UI_NONE, "Texas Rangers", UI_NONE); uiTick(tg); save(dir, "g3_score_not_started");
  uiShowFact(tg, "AAPL", "$187.42", "+1.2% today", "As of 3:58 PM", 1); uiTick(tg); save(dir, "g4_fact_price_up");
  uiShowFact(tg, "Drive home", "24 min", "Heavy traffic on I-10", "", 2); uiTick(tg); save(dir, "g5_fact_words");
  uiShowFact(tg, "Bitcoin", "$101,234.50", "-0.8% in 24 hours", "", 2); uiTick(tg); save(dir, "g6_fact_long_number");
  uiShowFact(tg, "Oven", "350\x7f" "F", "Preheat for 15 minutes", "", 0); uiTick(tg); save(dir, "g7_fact_degrees");
  {
    const char *labels[5] = { "Standup", "Lunch with Sam", "Design review with the team", "Dentist", "Pick up kids" };
    const char *values[5] = { "9:00 AM", "12:30 PM", "2:00 PM", "4:15 PM", "5:30 PM" };
    uiShowList(tg, "Today", 5, labels, values); uiTick(tg); save(dir, "g8_list_five");
    uiShowList(tg, "Next up", 3, labels, values); uiTick(tg); save(dir, "g9_list_three");
  }
  // 10. touch: a giggle (frames while he hops) and his eyes following a finger
  uiClearCard(); uiMotion = true; uiSetMode(UI_READY); uiSetWords(""); uiSetHeard(""); uiAll = true; uiNextBlink = 999999; uiNextGlance = 999999;
  uint32_t th = 60000; uiTick(th);
  int gx = uiStageX + uiStageW / 2, gy = uiStageY + uiStageH / 2;
  uiTouch(th, true, gx, gy); uiTick(th); th += 60; uiTouch(th, false, gx, gy); uiTick(th);
  const uint32_t giggleAt[] = { 60, 160, 260, 380 };
  for (int i = 0; i < 4; i++) { uiTick(th + giggleAt[i]); char nm[40]; snprintf(nm, sizeof nm, "t%d_giggle", i); save(dir, nm); }
  th += 3000; uiTick(th);
  uiTouch(th, true, 380, 120); uiTick(th); th += 100; uiTouch(th, true, 380, 120); uiTick(th); save(dir, "t4_look_right");
  uiTouch(th, true, 40, 400); th += 100; uiTouch(th, true, 40, 400); uiTick(th); save(dir, "t5_look_left_down");
  // 11. the idle face: 4:15 PM on Monday 9 Nov 2026 in Chicago; a meeting in 25 minutes
  uiClearCard(); uiMotion = true; uiSetMode(UI_READY); uiAll = true; uiNextBlink = 999999; uiNextGlance = 999999;
  uiIdle.have = true; uiIdle.baseUtc = 1794262500u; uiIdle.baseMs = 200000; uiIdle.off = -360; uiIdle.after = 20;
  uiIdle.dim = true; uiIdle.showW = true; uiIdle.showM = true;
  uiIdle.haveW = true; uiIdle.wt = 72; uiIdle.wi = UI_ICON_PARTLY; strcpy(uiIdle.ws, "Partly cloudy"); uiIdle.wh = 80; uiIdle.wl = 65;
  uiIdle.mc = true; uiIdle.haveM = true; strcpy(uiIdle.mt, "Team sync"); uiIdle.ms = 1794264000u; uiIdle.me = 1794264000u + 1800;
  uiSetBattery(85, false, 0x28, 0x01);
  uiLastActive = 200000; uiTick(200100); uiTick(200000 + 20100);
  CHECK_IDLE(uiIdleOn, "the idle face comes after 20 s of quiet");
  save(dir, "i1_idle_meeting_soon");
  uiSetBattery(100, true, 0x28, 0x21); uiAll = true; uiTick(200000 + 20150); save(dir, "i1b_idle_battery_charging");
  uiSetBattery(12, false, 0x28, 0x41); uiAll = true; uiTick(200000 + 20160); save(dir, "i1c_idle_battery_low");
  uiSetBattery(-1, false, 0x00, 0x00); uiAll = true; uiTick(200000 + 20170); save(dir, "i1d_idle_no_battery");
  uiSetBattery(85, false, 0x28, 0x01); uiAll = true; uiTick(200000 + 20180);
  uiIdle.ms = 1794326400u; uiIdle.me = 1794326400u + 3600; strcpy(uiIdle.mt, "Amazon interview with Dana"); uiIdleMinute = -1; uiAll = true; uiTick(200000 + 20200); save(dir, "i2_idle_meeting_tomorrow");
  uiIdle.haveM = false; uiAll = true; uiTick(200000 + 20300); save(dir, "i3_idle_no_meetings");
  uiIdle.haveW = false; uiIdle.haveM = true; uiAll = true; uiTick(200000 + 20400); save(dir, "i4_idle_no_weather");
  uiIdle.haveW = true; uiIdle.wi = UI_ICON_MOON; strcpy(uiIdle.ws, "Mostly clear, chilly"); uiAll = true; uiTick(200000 + 20500); save(dir, "i5_idle_night_long_sky");
  uiTick(200000 + 20100 + 61000);
  CHECK_IDLE(uiDimmed, "dims after a minute");
  uiActivity(200000 + 90000); uiTick(200000 + 90100);
  CHECK_IDLE(!uiIdleOn && !uiDimmed, "any activity wakes it");
  uiIdle.after = 0; uiTick(200000 + 300000);
  CHECK_IDLE(!uiIdleOn, "with idle turned off it never comes");
  uiIdle.after = 20;
  // timing of one frame (host speed, not the watch's)
  UiPose p; uiPoseNow(7000, &p);
  double t0 = now(); for (int i = 0; i < 20; i++) uiRenderStage(p, uiStageX, uiStageY, uiStageW, uiStageH);
  printf("small-layout stage %dx%d: %.2f ms per frame on this computer\n", uiStageW, uiStageH, (now() - t0) / 20);
  uiSmall = false; UiPose big; uiBasePose(&big); int bx, by, bw, bh; uiStageRect(big, &bx, &by, &bw, &bh);
  t0 = now(); for (int i = 0; i < 20; i++) uiRenderStage(big, bx, by, bw, bh);
  printf("big-layout stage %dx%d: %.2f ms per frame on this computer\n", bw, bh, (now() - t0) / 20);
  printf("odd-aligned windows: %ld\n", oddWindows);
  return 0;
}
