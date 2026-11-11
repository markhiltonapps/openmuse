// Raise-to-wake: decides from the accelerometer when the watch has been picked up or the wrist lifted to look at it.
// Pure code (no hardware, no Arduino), so a computer can run it against scripted movements: firmware/tools/raise_test.cpp.
//
// The input is gravity in milli-g (1000 = 1 g), sampled about 30 times a second:
//   up  = how much of gravity runs through the screen (about +-1000 when the screen faces straight up or straight down, 0 when it is on its edge)
//   mag = the overall size of what the chip feels (about 1000 when still; walking, a shake or a knock is far from it)
//
// A "raise" is: the watch MOVED (its angle changed a lot over the last second and a half, or it was knocked), and now it is STILL with the screen
// roughly flat (over 0.6 g through it, either way up) for 200 ms. It does not matter where it started: hanging, on a desk, in a hand.
// The sign of `up` is ignored on purpose: which way the chip's axis points isn't known until a real board has been read, and a screen that
// brightens when put face down on a desk is a small price (the caller only listens while the screen is dimmed, and stops once it has brightened).
// Walking with the arm swinging (the screen stays on its edge) never counts, a shake isn't still, and a watch that just lies there never counts.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <math.h>

#define RAISE_FACE_MG 600          // over this (either way up) the screen is flat enough to be looked at (about 53 degrees from edge-on)
#define RAISE_FACE_DWELL_MS 200    // flat and still at least this long before it fires (a brief tilt doesn't count)
#define RAISE_STILL_LOW_MG 800     // "still" means the overall size is between these (a shake or a knock is outside)
#define RAISE_STILL_HIGH_MG 1250
#define RAISE_TURN_MG 400          // the angle changed this much within the history (about 1.6 s): the wrist turned or the watch was picked up
#define RAISE_KNOCK_MG 250         // the overall size this far from 1 g is a movement (a lift, a bump)
#define RAISE_KNOCK_WINDOW_MS 1000 // ... and counts for this long
#define RAISE_REFIRE_MS 1500       // never twice within this
#define RAISE_HIST 48              // samples of angle kept (48 x 33 ms)

struct RaiseDetector {
  bool have;                       // the filters have a first sample
  int up, mag;                     // filtered values, milli-g
  int hist[RAISE_HIST]; int histN, histAt;   // the last filtered `up` values, oldest overwritten first
  uint32_t lastKnock;              // when the overall size last left about 1 g (0 = not yet)
  uint32_t facingSince;            // when the current flat-and-still run began (0 = not in one)
  uint32_t lastFire;
};

static inline void raiseReset(RaiseDetector &d) {
  d.have = false; d.up = 0; d.mag = 1000; d.histN = 0; d.histAt = 0; d.lastKnock = 0; d.facingSince = 0; d.lastFire = 0;
}

// The overall size of three readings (milli-g).
static inline int raiseMag(int x, int y, int z) {
  return (int)sqrtf((float)x * x + (float)y * y + (float)z * z);
}

// One sample. `ms` must not be 0. Returns true once per raise.
static inline bool raiseFeed(RaiseDetector &d, uint32_t ms, int up, int mag) {
  if (!d.have) { d.have = true; d.up = up; d.mag = mag; }
  else { d.up += (up - d.up) / 2; d.mag += (mag - d.mag) / 2; }   // light smoothing, so a single noisy sample doesn't decide
  d.hist[d.histAt] = d.up; d.histAt = (d.histAt + 1) % RAISE_HIST; if (d.histN < RAISE_HIST) d.histN++;
  if (abs(mag - 1000) >= RAISE_KNOCK_MG) d.lastKnock = ms;
  int lo = d.hist[0], hi = d.hist[0];
  for (int i = 1; i < d.histN; i++) { if (d.hist[i] < lo) lo = d.hist[i]; if (d.hist[i] > hi) hi = d.hist[i]; }
  bool turned = (hi - lo) >= RAISE_TURN_MG;
  bool knocked = d.lastKnock != 0 && ms - d.lastKnock <= RAISE_KNOCK_WINDOW_MS;
  bool facing = abs(d.up) >= RAISE_FACE_MG && d.mag >= RAISE_STILL_LOW_MG && d.mag <= RAISE_STILL_HIGH_MG;
  if (!facing) { d.facingSince = 0; return false; }
  if (!d.facingSince) d.facingSince = ms;
  if ((turned || knocked) && ms - d.facingSince >= RAISE_FACE_DWELL_MS && (d.lastFire == 0 || ms - d.lastFire >= RAISE_REFIRE_MS)) {
    d.lastFire = ms; d.histN = 0; d.histAt = 0; d.lastKnock = 0;   // the next raise needs a new movement
    return true;
  }
  return false;
}
