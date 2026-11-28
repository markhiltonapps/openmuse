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
#if NEDDY_ROUND
  frHwBlit = simBlit; frHwFill = simFill;                // the round watch's last step: turning and the button marks (neddy_frame.h)
  frInit([](size_t n) -> void * { return malloc(n); });
  uiOut.blit = frBlit; uiOut.fill = frFill;
#endif
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
  // 12. the launcher (the PWR button): Neddy in the middle, icons round him
  uiIdleOn = false; uiClearCard(); uiSetMode(UI_READY); uiAll = true; uiFpsLevel = 1; uiRecAvailable = true; uiSetBattery(72, false, 0x28, 0x01);
  uiMotion = false;
  uiMenuOpen(500000); uiTick(500100); save(dir, "m1_launcher");
  // the Record pages: Voice note, Idea, Meeting, Dream
  for (int m = 0; m < 4; m++) { uiShellGo(UI_SHL_REC, m); uiTick(500200 + m); char nm[40]; snprintf(nm, sizeof nm, "n%d_record_%d", m, m); save(dir, nm); }
  // holding the circle to start: the ring half filled on Meeting, most of the way on Dream, and the page after letting go (drawn
  // directly, like Restart below, so the clock the later frames use isn't moved)
  uiShellGo(UI_SHL_REC, 2); uiTick(500204); uiDrawRecHold(0.5f); save(dir, "n2h_record_hold_half");
  uiDrawRecHold(0); uiTick(500205); save(dir, "n2r_record_let_go");
  uiShellGo(UI_SHL_REC, 3); uiTick(500206); uiDrawRecHold(0.8f); save(dir, "n3h_dream_hold_late");
  uiDrawRecHold(0); uiTick(500207);
  uiShellGo(UI_SHL_REC, 2); uiRecHintUntil = 500210 + 700; uiAll = true; uiTick(500210); save(dir, "n2t_record_tap_hint");   // a tap: HOLD TO START lights up
  uiRecHintUntil = 0; uiAll = true; uiTick(500211);

  // Settings, one a page
  uiBright = 70; uiVolume = 90; uiIdle.dim = true; uiIdle.dimAfter = 120; uiIdle.offAfter = 300;
  for (int pg = 0; pg < UI_PG_N; pg++) { uiShellGo(UI_SHL_SET, pg); uiTick(500300 + pg); char nm[40]; snprintf(nm, sizeof nm, "p%d_setting", pg); save(dir, nm); }
  uiAccentIdx = 1; uiShellGo(UI_SHL_SET, UI_PG_COLOUR); uiTick(500400); save(dir, "p4b_colour_blue");
  uiShellGo(UI_SHL_HOME, 0); uiTick(500410); save(dir, "m1b_launcher_blue");
  uiAccentIdx = 0;
  // Info, three pages
  strcpy(uiInfo.fw, "0.2.0"); strcpy(uiInfo.wifi, "Home Wi-Fi"); uiInfo.heapKb = 172; uiInfo.board = "1.75C round";
  for (int pg = 0; pg < 3; pg++) { uiShellGo(UI_SHL_INFO, pg); uiTick(500500 + pg); char nm[40]; snprintf(nm, sizeof nm, "q%d_info", pg); save(dir, nm); }
  for (int k = 1; k <= 2; k++) { uiDrawRestart(k * 0.5f); char nm[40]; snprintf(nm, sizeof nm, "q3_restart_hold_%d", k * 50); save(dir, nm); }
  uiClearCard(); uiRecAvailable = false; uiMotion = true;
  // 13. looking something up: Neddy reads his book, flames flicker (thinking, no words yet)
  uiIdleOn = false; uiClearCard(); uiIdle.have = false; uiSetWords(""); uiSetHeard(""); uiSetMode(UI_THINK); uiMotion = true; uiNextBlink = 999999; uiNextGlance = 999999; uiAll = true;
  uiLookup(600000, true); uiTick(600050); save(dir, "l1_lookup");
  uiTick(600350); save(dir, "l2_lookup_flip");
  uiLookup(600400, false); uiSetMode(UI_READY); uiAll = true; uiTick(600450);
  // 14. the watch faces: 4:15 PM on Monday 9 Nov 2026 (analog, neon digital), with a battery and the weather
  uiClearCard(); uiSetMode(UI_READY); uiMotion = true; uiNextBlink = 999999; uiNextGlance = 999999;
  uiIdle.have = true; uiIdle.baseUtc = 1794262500u; uiIdle.baseMs = 700000; uiIdle.off = -360; uiIdle.after = 20; uiIdle.showW = true; uiIdle.showM = true;
  uiIdle.haveW = true; uiIdle.wt = 56; uiIdle.wi = UI_ICON_PARTLY; strcpy(uiIdle.ws, "Slight chance rain showers"); uiSetBattery(85, false, 0x28, 0x01);
  uiLastActive = 700000;
  for (int face = 1; face <= 2; face++) {
    uiFace = face; uiIdleOn = false; uiAll = true; uiTick(700100); uiTick(700000 + 20100); uiIdleMinute = -1; uiAll = true; uiTick(700000 + 20200);
    save(dir, face == 1 ? "f1_face_analog" : "f2_face_neon");
  }
  uiFace = 0; uiIdleOn = false; uiIdle.have = false;
  // 15. the recording screens
  uiIdleOn = false; uiClearCard(); uiIdle.have = false; uiSetMode(UI_READY); uiAll = true; uiRecAvailable = true; uiFace = 0; uiRecMode = 3;
  uiRecRun(800200, 2530, 4680, 35); uiTick(800300); save(dir, "r1_recording");
  uiRecRun(800400, 2531, 4679, 35); uiTick(800500); save(dir, "r1b_recording_next_second");
  for (uint32_t e = 2546; e <= 2554; e++) { uiRecRun(800500 + e, e, 4680 - (e - 2530), 35); uiTick(800600 + e); }   // the bright dot passes under "Hold to stop"
  save(dir, "r1d_recording_dot_at_label");
  for (int k = 1; k <= 2; k++) { uiDrawStop(k * 0.5f); char nm[40]; snprintf(nm, sizeof nm, "r1c_stop_hold_%d", k * 50); save(dir, nm); }   // the hold's ring
  uiDrawStop(0);
  uiRecInfo(800500, "Sending to Neddy", "42 minutes", "Joining Wi-Fi, please wait", 0, ""); uiTick(800550); save(dir, "r2a_joining_wifi");
  uiRecInfo(800600, "Sending to Neddy", "42 minutes", "Please wait... 60%", 60, ""); uiTick(800700); save(dir, "r2_sending");
  uiRecInfo(800650, "Sending to Neddy", "42 minutes", "Finishing up... please wait", 100, ""); uiTick(800700); save(dir, "r2b_finishing");
  uiRecInfo(800800, "Sent", "42 minutes", "Your meeting is in Neddy", -1, "OK"); uiTick(800900); save(dir, "r3_sent");
  uiRecEnd(); uiRecAvailable = false;
#if NEDDY_ROUND
  // Auto-rotate: the same screen turned a quarter, half and three quarters; the marks stay next to the real buttons (small at 4, big at 1 o'clock).
  uiClearCard(); uiIdleOn = false; uiSetMode(UI_READY); uiSetWords(""); uiAll = true; uiTick(810000);
  for (int k = 1; k <= 3; k++) { uiTurn(k); uiTick(810000 + k); char nm[40]; snprintf(nm, sizeof nm, "t%d_turned_%d", k, k * 90); save(dir, nm); }
  uiTurn(0); uiTick(810010); save(dir, "t0_upright_again");
  // The busier screens, turned too, and a count of anything drawn under a mark (it must be 0): the launcher, Settings, a Record page,
  // and the recording screen, each at a quarter, half and three-quarter turn.
  {
    long under = 0;
    static uint32_t clk = 830000;                      // the watch's clock only moves forward (backwards reads as weeks of quiet)
    auto hidden = [&](const char *what) {              // draws the screen again without the marks and counts content where a mark sits
      bool was[FR_MARKS];
      for (int i = 0; i < FR_MARKS; i++) was[i] = frMarks[i].on;
      frHideMarks = true;
      uiAll = true; if (uiRec.state != UI_RECS_OFF) uiRec.full = true;
      uiTick(clk += 10);
      long n = 0;
      for (int i = 0; i < FR_MARKS; i++) {
        if (!was[i]) continue;
        const FrLayer *ls[2] = { &frMarks[i].arc, &frMarks[i].text };
        for (int j = 0; j < 2; j++) {
          const FrLayer &l = *ls[j];
          for (int y = 0; y < l.h; y++) for (int x = 0; x < l.w; x++) {
            if (l.a[y * l.w + x] < 40) continue;
            int gx, gy; frToGlass(frRot, l.x + x, l.y + y, &gx, &gy);
            uint16_t c = fb[gy * UI_W + gx];
            if (((c >> 11) & 31) + ((c >> 5) & 63) / 2 + (c & 31) > 6) n++;   // not black
          }
        }
      }
      frHideMarks = false;
      if (n) printf("UNDER A MARK: %s has %ld content pixels under a mark\n", what, n);
      under += n;
      uiAll = true; if (uiRec.state != UI_RECS_OFF) uiRec.full = true;
      uiTick(clk += 10);
    };
    struct Shot { const char *name; int kind; };
    const Shot shots[] = { { "launcher", 0 }, { "settings", 1 }, { "record", 2 }, { "recording", 3 } };
    for (const Shot &sh : shots) {
      for (int k = 0; k <= 3; k++) {
        uiTurn(k);
        uiRecEnd(); uiClearCard(); uiIdleOn = false; uiSetMode(UI_READY);
        uiActivity(clk += 10);
        if (sh.kind == 0) uiMenuOpen(clk);
        else if (sh.kind == 1) { uiMenuOpen(clk); uiShellGo(UI_SHL_SET, 0); }
        else if (sh.kind == 2) { uiMenuOpen(clk); uiShellGo(UI_SHL_REC, 2); }
        else { uiRecAvailable = true; uiRecMode = 2; uiRecRun(clk += 10, 2530, 4680, 35); }
        uiAll = true; uiTick(clk += 10);
        char nm[48]; snprintf(nm, sizeof nm, "u%d_%s_turn%d", sh.kind, sh.name, k);
        save(dir, nm);
        hidden(nm);
      }
    }
    uiRecEnd(); uiClearCard(); uiTurn(0); uiTick(clk += 10);
    printf("content under a mark: %ld\n", under);
  }
#endif
  // Wi-Fi setup screens
  uiSetupScreen(UI_SETUP_JOIN, "Neddy-1A2B", "WIFI:T:WPA;S:Neddy-1A2B;P:k7m2q9xd;;", "192.168.4.1"); save(dir, "w1_setup_join");
  uiSetupScreen(UI_SETUP_PAGE, "Neddy-1A2B", "http://192.168.4.1/", "192.168.4.1"); uiSetupDiag("reached watch: page 1  checks 3  other 2"); save(dir, "w2_setup_page");
  uiSetupScreen(UI_SETUP_BLE, "Neddy-5AFE", "https://neddy.neatoventures.com/watch-setup.html#n=5AFE&k=482913", ""); save(dir, "w0_setup_bluetooth");
  uiSetupScreen(UI_SETUP_BLE_PHONE, "Neddy-5AFE", "", ""); save(dir, "w0b_setup_bluetooth_phone");
  uiSetupScreen(UI_SETUP_TRYING, "Home Wi-Fi", "", ""); save(dir, "w3_setup_trying");
  uiSetupScreen(UI_SETUP_DONE, "Home Wi-Fi", "", ""); save(dir, "w4_setup_done");
  uiSetupScreen(UI_SETUP_FAIL, "Home Wi-Fi", "", ""); save(dir, "w5_setup_fail");
  printf("odd-aligned windows: %ld\n", oddWindows);
  return 0;
}
