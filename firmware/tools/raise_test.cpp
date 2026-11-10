// Tests of the watch's raise-to-wake detector on a computer: scripted wrist movements (gravity readings every 33 ms) go through
// raiseFeed (the same code the watch runs) and the number of times it fires is checked. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/raise_test.cpp -o /tmp/raise_test && /tmp/raise_test
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <vector>
#include "neddy_raise.h"

static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

struct S { int up, other; };     // `other` is the rest of gravity along the arm (so the overall size is realistic)
static std::vector<S> trace;
// Holds a pose for `ms` milliseconds. Gravity splits between "up" (out of the screen) and the arm's own axis.
static void hold(int up, uint32_t ms, int noise = 0) {
  int other = (int)sqrtf(fmaxf(0.f, 1000.f * 1000.f - (float)up * up));
  for (uint32_t t = 0; t < ms; t += 33) {
    int n = noise ? (rand() % (2 * noise + 1)) - noise : 0;
    trace.push_back({ up + n, other + n });
  }
}
// Turns smoothly from one pose to another over `ms`.
static void turn(int from, int to, uint32_t ms) {
  for (uint32_t t = 0; t < ms; t += 33) {
    int up = from + (int)((long)(to - from) * (long)t / (long)ms);
    int other = (int)sqrtf(fmaxf(0.f, 1000.f * 1000.f - (float)up * up));
    trace.push_back({ up, other });
  }
}
// Runs the trace; returns how many times it fired. `at` gets the time of the first fire.
static int run(uint32_t *at = nullptr, RaiseDetector *keep = nullptr) {
  RaiseDetector d; raiseReset(d);
  int fires = 0; uint32_t ms = 5000;
  if (at) *at = 0;
  for (auto &s : trace) {
    if (raiseFeed(d, ms, s.up, raiseMag(s.up, s.other, 0))) { fires++; if (at && !*at) *at = ms; }
    ms += 33;
  }
  if (keep) *keep = d;
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

  // A slow wrist turn (two seconds) counts too.
  hold(0, 800); turn(0, 850, 2000); hold(850, 800);
  CHECK(run() == 1, "a slow wrist turn fires once");

  // Lying face up on a desk from the start: it never fires by itself.
  hold(1000, 20000);
  CHECK(run() == 0, "lying face up on a desk doesn't fire");

  // Picked up off a desk and tilted toward the face without ever turning away: no fire (it was already facing up).
  hold(1000, 3000); turn(1000, 700, 600); hold(700, 2000);
  CHECK(run() == 0, "tilting it up from flat doesn't fire");

  // Face down on a desk, then flipped face up: that is a wake.
  hold(-1000, 3000); turn(-1000, 1000, 600); hold(1000, 1000);
  CHECK(run() == 1, "flipping it from face down to face up fires once");

  // Walking: the arm swings and the screen stays on its edge (up stays small), the overall size swings a lot.
  for (int i = 0; i < 80; i++) { int up = (int)(150 * sin(i * 0.4)); int other = 1000 + (int)(500 * sin(i * 0.4 + 1)); trace.push_back({ up, other }); }
  CHECK(run() == 0, "walking with the arm swinging doesn't fire");

  // Shaking while the screen points up: too violent to count as looking at it.
  hold(0, 1000);
  for (int i = 0; i < 60; i++) { int up = 900 + ((i % 2) ? 1500 : -300); trace.push_back({ up, 400 + ((i % 3) * 700) }); }
  CHECK(run() == 0, "a shake doesn't fire");

  // A brief tilt that doesn't stay (100 ms) doesn't fire.
  hold(0, 1000); hold(900, 100); hold(0, 1000);
  CHECK(run() == 0, "a flick shorter than 200 ms doesn't fire");

  // Staying turned toward you doesn't fire again; lowering and lifting again does.
  hold(0, 1000); turn(0, 900, 400); hold(900, 10000);
  CHECK(run() == 1, "holding the watch up for ten seconds fires only once");
  hold(0, 1000); turn(0, 900, 400); hold(900, 1000); turn(900, 0, 400); hold(0, 1000); turn(0, 900, 400); hold(900, 1000);
  CHECK(run() == 2, "lowering and lifting again fires again");

  // Not away for long enough (under 300 ms) before the lift: no fire (a quick dip while looking at it, such as a bump of the wrist).
  hold(900, 3000); hold(0, 66); hold(900, 1000);
  CHECK(run() == 0, "a dip under 300 ms isn't turned away long enough");

  // Noise around the thresholds doesn't make it fire over and over while facing.
  hold(0, 1000); turn(0, 700, 300); hold(700, 8000, 90);
  CHECK(run() <= 1, "noise near the line fires at most once");

  // The overall size is smoothed, so one noisy sample doesn't decide.
  { RaiseDetector d; raiseReset(d); uint32_t ms = 5000; int fires = 0;
    for (int i = 0; i < 20; i++) { raiseFeed(d, ms, 0, 1000); ms += 33; }
    fires += raiseFeed(d, ms, 1000, 1000); ms += 33;      // one clean sample only
    for (int i = 0; i < 20; i++) { fires += raiseFeed(d, ms, 0, 1000); ms += 33; }
    CHECK(fires == 0, "a single sample facing up doesn't fire"); }

  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
