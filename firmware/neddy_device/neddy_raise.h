// Raise-to-wake: decides from the accelerometer when a wrist has been lifted to look at the watch.
// Pure code (no hardware, no Arduino), so a computer can run it against scripted movements: firmware/tools/raise_test.cpp.
//
// The input is gravity in milli-g (1000 = 1 g) split in two numbers, sampled about 30 times a second:
//   up  = how much of gravity points out of the screen (+1000 lying face up, 0 hanging at the side or on its edge, -1000 face down)
//   mag = the overall size of what the chip feels (about 1000 when still; walking, a shake or a knock is far from it)
//
// A "raise" is the watch going from turned away (up under AWAY_MG for AWAY_DWELL_MS: hanging, on its edge, face down) to facing the
// person (up over FACE_MG and still for FACE_DWELL_MS). Needing the turned-away part first means a watch lying face up on a desk
// never fires by itself, a swinging arm while walking (the screen stays on its edge) never fires, and one raise fires once.
#pragma once
#include <stdint.h>
#include <math.h>

#define RAISE_AWAY_MG 450          // under this the screen is turned away
#define RAISE_FACE_MG 650          // over this the screen faces up toward the person's eyes (about 40 degrees from flat)
#define RAISE_AWAY_DWELL_MS 300    // turned away at least this long before a raise counts
#define RAISE_FACE_DWELL_MS 200    // facing and still at least this long before it fires (a brief tilt doesn't count)
#define RAISE_STILL_LOW_MG 800     // "still" means the overall size is between these (a shake or a knock is outside)
#define RAISE_STILL_HIGH_MG 1250
#define RAISE_REFIRE_MS 1500       // never twice within this

struct RaiseDetector {
  bool have;                       // the filters have a first sample
  int up, mag;                     // filtered values, milli-g
  bool armed;                      // seen turned away long enough
  uint32_t awaySince, facingSince; // when the current run began (0 = not in one)
  uint32_t lastFire;
};

static inline void raiseReset(RaiseDetector &d) {
  d.have = false; d.up = 0; d.mag = 1000; d.armed = false; d.awaySince = 0; d.facingSince = 0; d.lastFire = 0;
}

// The overall size of three readings (milli-g).
static inline int raiseMag(int x, int y, int z) {
  return (int)sqrtf((float)x * x + (float)y * y + (float)z * z);
}

// One sample. `ms` must not be 0. Returns true once per raise.
static inline bool raiseFeed(RaiseDetector &d, uint32_t ms, int up, int mag) {
  if (!d.have) { d.have = true; d.up = up; d.mag = mag; }
  else { d.up += (up - d.up) / 2; d.mag += (mag - d.mag) / 2; }   // light smoothing, so a single noisy sample doesn't decide
  bool away = d.up < RAISE_AWAY_MG;
  bool facing = d.up >= RAISE_FACE_MG && d.mag >= RAISE_STILL_LOW_MG && d.mag <= RAISE_STILL_HIGH_MG;
  if (away) {
    if (!d.awaySince) d.awaySince = ms;
    if (ms - d.awaySince >= RAISE_AWAY_DWELL_MS) d.armed = true;
  } else d.awaySince = 0;
  if (!facing) { d.facingSince = 0; return false; }
  if (!d.facingSince) d.facingSince = ms;
  if (d.armed && ms - d.facingSince >= RAISE_FACE_DWELL_MS && (d.lastFire == 0 || ms - d.lastFire >= RAISE_REFIRE_MS)) {
    d.armed = false; d.lastFire = ms;
    return true;
  }
  return false;
}
