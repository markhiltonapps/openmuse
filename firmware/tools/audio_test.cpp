// Tests of how the watch shapes Neddy's voice for its tiny speaker (neddy_audio.h, the same code the watch runs).
// Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/audio_test.cpp -o /tmp/audio_test && /tmp/audio_test
#include <cstdio>
#include <cmath>
#include <vector>
#include "neddy_audio.h"

static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

static const float RATE = 16000.0f;

static std::vector<int16_t> sine(float hz, float amp, float seconds) {
  std::vector<int16_t> v((size_t)(RATE * seconds));
  for (size_t i = 0; i < v.size(); i++) v[i] = (int16_t)lrintf(amp * sinf(2.0f * 3.14159265f * hz * (float)i / RATE));
  return v;
}
// Runs a sound through a fresh shaper; returns the output.
static std::vector<int16_t> shape(const std::vector<int16_t> &in) {
  AudioShaper s; audioInit(s, RATE);
  std::vector<int16_t> out(in.size());
  for (size_t i = 0; i < in.size(); i++) out[i] = audioShape(s, in[i]);
  return out;
}
// Loudness (RMS) of the last half, after the filter and limiter have settled.
static double rms(const std::vector<int16_t> &v) {
  double sum = 0; size_t from = v.size() / 2;
  for (size_t i = from; i < v.size(); i++) sum += (double)v[i] * v[i];
  return sqrt(sum / (double)(v.size() - from));
}
static int peak(const std::vector<int16_t> &v) { int p = 0; for (auto x : v) p = abs(x) > p ? abs(x) : p; return p; }

int main() {
  // The volume never goes above the chip's clean full level, steps half a decibel, and 0 is silent.
  CHECK(audioVolumeReg(100) == 0xBF, "100 is the chip's 0 dB (0xBF), not 0xFF");
  CHECK(audioVolumeReg(150) == 0xBF, "over 100 is still 0 dB");
  CHECK(audioVolumeReg(0) == 0, "0 is silent");
  CHECK(audioVolumeReg(-5) == 0, "below 0 is silent");
  CHECK(audioVolumeReg(1) == 0xBF - 99, "1 is 49.5 dB down");
  CHECK(audioVolumeReg(85) == 0xBF - 15, "85 (the old default) is 7.5 dB down");
  bool rising = true, clean = true;
  for (int v = 1; v <= 100; v++) { if (audioVolumeReg(v) <= audioVolumeReg(v - 1)) rising = false; if (audioVolumeReg(v) > 0xBF) clean = false; }
  CHECK(rising, "every step up is louder");
  CHECK(clean, "no volume adds the chip's own gain (above 0xBF)");

  // A full-scale voice: never clips and stays under the limit.
  auto loud = shape(sine(1000, 32767, 1.0f));
  CHECK(peak(loud) <= (int)AUDIO_LIMIT + 1, "a full-scale 1 kHz note stays under the limit");
  CHECK(rms(loud) > 0.6 * AUDIO_LIMIT / sqrt(2.0), "... and is still loud (the limiter turns it down, doesn't silence it)");

  // A quiet voice gets the lift.
  auto quiet = shape(sine(1000, 3000, 1.0f));
  double lift = rms(quiet) / rms(sine(1000, 3000, 1.0f));
  double want = pow(10.0, SPEAKER_BOOST_DB / 20.0);
  CHECK(fabs(lift - want) < 0.1 * want, "a quiet 1 kHz note is lifted by SPEAKER_BOOST_DB");
  CHECK(peak(quiet) < (int)AUDIO_LIMIT, "... and the limiter leaves it alone");

  // Deep bass is turned down: 100 Hz loses most of its strength, 2 kHz keeps it.
  double bass = rms(shape(sine(100, 3000, 1.0f))) / rms(sine(100, 3000, 1.0f));
  double treble = rms(shape(sine(2000, 3000, 1.0f))) / rms(sine(2000, 3000, 1.0f));
  printf("100 Hz kept %.2f, 2 kHz kept %.2f, 1 kHz lift %.2f\n", bass, treble, lift);
  CHECK(bass < 0.25 * treble, "100 Hz is at least 12 dB quieter than 2 kHz");
  CHECK(treble > 0.9 * want, "2 kHz passes with the lift");

  // A loud moment then quiet talk: the limiter lets go within a fraction of a second.
  {
    AudioShaper s; audioInit(s, RATE);
    auto a = sine(1000, 32767, 0.3f), b = sine(1000, 3000, 0.5f);
    for (auto x : a) audioShape(s, x);
    std::vector<int16_t> out;
    for (auto x : b) out.push_back(audioShape(s, x));
    std::vector<int16_t> tail(out.begin() + (long)(RATE * 0.3f), out.end());
    double after = rms(tail) / rms(b);
    CHECK(fabs(after - want) < 0.1 * want, "after a loud moment, quiet talk is back to full lift within 0.3 s");
  }

  // Silence stays silent, and a reset forgets the past.
  {
    AudioShaper s; audioInit(s, RATE);
    for (auto x : sine(150, 32767, 0.2f)) audioShape(s, x);
    audioReset(s);
    bool silent = true;
    for (int i = 0; i < 1000; i++) if (audioShape(s, 0) != 0) silent = false;
    CHECK(silent, "after a reset, silence is silent (no tail of the old sound)");
  }
  // The worst case: full-scale square-ish bass plus treble never wraps round.
  {
    std::vector<int16_t> mix(16000);
    for (size_t i = 0; i < mix.size(); i++) mix[i] = (i / 40) % 2 ? 32767 : -32768;
    CHECK(peak(shape(mix)) <= (int)AUDIO_LIMIT + 1, "a full-scale square wave stays under the limit");
  }

  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures ? 1 : 0;
}
