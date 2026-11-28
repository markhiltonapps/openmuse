// How Neddy's voice is shaped for the watch's tiny speaker. Pure code (no hardware, no Arduino), so a computer can run it:
// firmware/tools/audio_test.cpp.
//
// Why: the audio chip (ES8311) treats its volume register 0xBF as full, clean level (0 dB). The driver we started from mapped
// 100% to 0xFF, about 32 dB ABOVE that, so anything past ~75% boosted a voice that was already at full level and the loud
// parts crackled ("garbled and choppy above 80", owner, 2026-11-28). Now:
//   - the volume (0 to 100) only ever turns the chip DOWN from clean full: 100 = 0 dB, each step below is half a decibel
//     (the chip's own step), 1 is about 50 dB quieter, 0 is silent. No setting can clip.
//   - a bass cut (a gentle filter below ~300 Hz) leaves out the deep notes a speaker this small can't play anyway; they only
//     rattle it and waste power, and voices are clearer without them.
//   - a small lift (AUDIO_BOOST_DB) with a limiter: the loudest moments are turned down smoothly instead of being cut off,
//     so the voice is a little louder than the chip's clean full level and still clean.
#pragma once
#include <stdint.h>
#include <math.h>

#ifndef SPEAKER_BOOST_DB
#define SPEAKER_BOOST_DB 6          // the lift before the limiter; 0 turns it off (lower it if 100 still crackles on a board)
#endif
#ifndef SPEAKER_BASS_CUT_HZ
#define SPEAKER_BASS_CUT_HZ 300     // below this the filter turns the sound down (12 dB per octave); 0 turns it off
#endif
#define AUDIO_CLEAN_REG 0xBF        // the chip's 0 dB
#define AUDIO_LIMIT 29000.0f        // the limiter keeps every sample under this (about 1 dB below the top)
#define AUDIO_RELEASE_MS 60.0f      // how fast the limiter lets go after a loud moment

// The chip's volume register for a volume of 0 to 100.
static inline int audioVolumeReg(int volume) {
  if (volume <= 0) return 0;
  if (volume > 100) volume = 100;
  return AUDIO_CLEAN_REG - (100 - volume);
}

struct AudioShaper {
  float b0, b1, b2, a1, a2;        // the bass cut (a second-order high-pass, Butterworth)
  float x1, x2, y1, y2;            // its memory
  float gain;                      // the lift, as a multiplier
  float env;                       // the limiter's view of how loud it is now
  float release;                   // how much of that view is kept each sample
};

static inline void audioReset(AudioShaper &s) { s.x1 = s.x2 = s.y1 = s.y2 = 0; s.env = 0; }

static inline void audioInit(AudioShaper &s, float sampleRate) {
  if (SPEAKER_BASS_CUT_HZ > 0) {
    float w0 = 2.0f * 3.14159265f * (float)SPEAKER_BASS_CUT_HZ / sampleRate;
    float cw = cosf(w0), alpha = sinf(w0) / (2.0f * 0.70710678f);
    float a0 = 1.0f + alpha;
    s.b0 = (1.0f + cw) / 2.0f / a0;
    s.b1 = -(1.0f + cw) / a0;
    s.b2 = s.b0;
    s.a1 = -2.0f * cw / a0;
    s.a2 = (1.0f - alpha) / a0;
  } else {
    s.b0 = 1; s.b1 = s.b2 = s.a1 = s.a2 = 0;
  }
  s.gain = powf(10.0f, (float)SPEAKER_BOOST_DB / 20.0f);
  s.release = expf(-1.0f / (AUDIO_RELEASE_MS * 0.001f * sampleRate));
  audioReset(s);
}

// Shapes one sample.
static inline int16_t audioShape(AudioShaper &s, int16_t in) {
  float x = (float)in;
  float y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
  s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
  if (fabsf(s.y1) < 1e-20f) s.y1 = 0;               // no denormals in long silences
  y *= s.gain;
  float a = fabsf(y);
  s.env = a > s.env ? a : s.env * s.release;       // jumps up at once, lets go slowly
  if (s.env > AUDIO_LIMIT) y *= AUDIO_LIMIT / s.env;
  if (y > 32767.0f) y = 32767.0f;                   // never needed, but a sum can't wrap round
  if (y < -32768.0f) y = -32768.0f;
  return (int16_t)lrintf(y);
}
