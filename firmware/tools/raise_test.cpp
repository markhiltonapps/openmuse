// Tests of the watch's raise-to-wake detector on a computer: scripted movements (gravity readings every 33 ms) go through
// raiseFeed (the same code the watch runs) and the number of times it fires is checked. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/raise_test.cpp -o /tmp/raise_test && /tmp/raise_test
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <vector>
#include "neddy_raise.h"

static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

struct S { int up, mag; };       // what the sketch hands the detector: the screen's share of gravity and the overall size
static std::vector<S> trace;
// Holds a pose for `ms` milliseconds (overall size 1 g, plus a little noise if asked).
static void hold(int up, uint32_t ms, int noise = 0) {
  for (uint32_t t = 0; t < ms; t += 33) {
    int n = noise ? (rand() % (2 * noise + 1)) - noise : 0;
    trace.push_back({ up + n, 1000 + n });
  }
}
// Holds a pose but with the overall size off 1 g (a lift, a bump).
static void shaky(int up, int mag, uint32_t ms) { for (uint32_t t = 0; t < ms; t += 33) trace.push_back({ up, mag }); }
// Turns smoothly from one pose to another over `ms`.
static void turn(int from, int to, uint32_t ms) {
  for (uint32_t t = 0; t < ms; t += 33) trace.push_back({ from + (int)((long)(to - from) * (long)t / (long)ms), 1000 });
}
// Runs the trace; returns how many times it fired. `at` gets the time of the first fire.
static int run(uint32_t *at = nullptr) {
  RaiseDetector d; raiseReset(d);
  int fires = 0; uint32_t ms = 5000;
  if (at) *at = 0;
  for (auto &s : trace) {
    if (raiseFeed(d, ms, s.up, s.mag)) { fires++; if (at && !*at) *at = ms; }
    ms += 33;
  }
  trace.clear();
  return fires;
}

int main() {
  srand(7);

  // The arm hangs for a second, then lifts to look at the watch within half a second and holds.
  hold(0, 1000); turn(0, 900, 500); hold(900, 1000);
  uint32_t at = 0;
  CHECK(run(&at) == 1, "a normal raise fires once");
  CHECK(at > 5000 + 1000 && at < 5000 + 1000 + 500 + 400, "and fires soon after the watch settles facing you");

  // The sign of the chip's axis isn't known yet: the same raise the other way round fires just the same.
  hold(0, 1000); turn(0, -900, 500); hold(-900, 1000);
  CHECK(run() == 1, "a raise reads the same whichever way the chip's axis points");

  // A slow wrist turn (two seconds) counts too.
  hold(0, 800); turn(0, 850, 2000); hold(850, 800);
  CHECK(run() == 1, "a slow wrist turn fires once");

  // Lying face up on a desk from the start: it never fires by itself.
  hold(1000, 20000);
  CHECK(run() == 0, "lying face up on a desk doesn't fire");

  // Picked up off a desk (the lift shows as the overall size leaving 1 g) and looked at: that wakes it, whatever the start.
  hold(1000, 3000); shaky(900, 1400, 130); turn(900, 800, 300); hold(800, 1500);
  CHECK(run() == 1, "picking it up off a desk to look at it fires");

  // A small tilt from flat with no lift or knock: nothing to wake for.
  hold(1000, 3000); turn(1000, 700, 600); hold(700, 2000);
  CHECK(run() == 0, "a small tilt from flat doesn't fire");

  // A tiny tap on the desk (the overall size only 150 mg off) isn't a movement.
  hold(1000, 3000); shaky(1000, 1150, 100); hold(1000, 2000);
  CHECK(run() == 0, "a tiny knock on the desk doesn't fire");

  // Face down on a desk, then flipped face up: that is a wake.
  hold(-1000, 3000); turn(-1000, 1000, 600); hold(1000, 1000);
  CHECK(run() == 1, "flipping it from face down to face up fires once");

  // The cost of not knowing which way up the chip's axis points: a knock while it lies face down also wakes the screen.
  hold(-1000, 3000); shaky(-1000, 1500, 100); hold(-1000, 1000);
  CHECK(run() == 1, "a knock on a watch lying face down wakes it (known side effect)");

  // Walking: the arm swings and the screen stays on its edge (up stays small), the overall size swings a lot.
  for (int i = 0; i < 80; i++) { int up = (int)(150 * sin(i * 0.4)); int mag = 1000 + (int)(500 * sin(i * 0.4 + 1)); trace.push_back({ up, mag }); }
  CHECK(run() == 0, "walking with the arm swinging doesn't fire");

  // Shaking while the screen points up: too violent to count as looking at it.
  hold(0, 1000);
  for (int i = 0; i < 60; i++) trace.push_back({ 900 + ((i % 2) ? 1500 : -300), 400 + ((i % 3) * 700) });
  CHECK(run() == 0, "a shake doesn't fire");

  // A brief tilt that doesn't stay (100 ms) doesn't fire.
  hold(0, 1000); hold(900, 100); hold(0, 1000);
  CHECK(run() == 0, "a flick shorter than 200 ms doesn't fire");

  // A jostle while looking at it (the wrist bumps and settles again) wakes a dimmed screen: that is what someone looking at it wants.
  hold(900, 3000); hold(0, 66); hold(900, 1000);
  CHECK(run() == 1, "a jostle while looking at it fires");

  // Staying turned toward you doesn't fire again; lowering and lifting again does.
  hold(0, 1000); turn(0, 900, 400); hold(900, 10000);
  CHECK(run() == 1, "holding the watch up for ten seconds fires only once");
  hold(0, 1000); turn(0, 900, 400); hold(900, 1000); turn(900, 0, 400); hold(0, 1000); turn(0, 900, 400); hold(900, 1000);
  CHECK(run() == 2, "lowering and lifting again fires again");

  // Noise around the thresholds doesn't make it fire over and over while facing.
  hold(0, 1000); turn(0, 700, 300); hold(700, 8000, 90);
  CHECK(run() <= 1, "noise near the line fires at most once");

  // The readings are smoothed, so one noisy sample doesn't decide.
  { RaiseDetector d; raiseReset(d); uint32_t ms = 5000; int fires = 0;
    for (int i = 0; i < 20; i++) { raiseFeed(d, ms, 0, 1000); ms += 33; }
    fires += raiseFeed(d, ms, 1000, 1000); ms += 33;      // one clean sample only
    for (int i = 0; i < 20; i++) { fires += raiseFeed(d, ms, 0, 1000); ms += 33; }
    CHECK(fires == 0, "a single sample facing up doesn't fire"); }

  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
