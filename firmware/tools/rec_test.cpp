// Tests of the watch's recorder (neddy_rec.h) on a computer, with flash made of memory that behaves like the real thing:
// erasing sets bytes to 0xFF, writing can only clear bits. Build and run:
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/rec_test.cpp -o /tmp/rec_test && /tmp/rec_test [fixture.bin]
// With a file name it also writes what was stored (header + slots), which the server's test decodes and compares with ffmpeg.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "neddy_rec.h"

static std::vector<uint8_t> flash;
static long violations = 0, erases = 0, writes = 0;
static bool eraseFn(uint32_t off, uint32_t len) {
  if (off % REC_SECTOR || len % REC_SECTOR || off + len > flash.size()) { violations++; return false; }
  for (uint32_t i = 0; i < len; i++) flash[off + i] = 0xFF;
  erases++; return true;
}
static bool writeFn(uint32_t off, const uint8_t *d, uint32_t len) {
  if (off + len > flash.size()) { violations++; return false; }
  for (uint32_t i = 0; i < len; i++) {
    if ((d[i] & ~flash[off + i]) != 0) violations++;               // a bit would have to go from 0 back to 1: real flash can't
    flash[off + i] &= d[i];
  }
  writes++; return true;
}
static bool readFn(uint32_t off, uint8_t *d, uint32_t len) {
  if (off + len > flash.size()) return false;
  memcpy(d, &flash[off], len); return true;
}
static RecIO makeIO(uint32_t size) { flash.assign(size, 0xFF); return RecIO{ eraseFn, writeFn, readFn, size }; }

static int failures = 0, checks = 0;
#define CHECK(cond, what) do { checks++; if (!(cond)) { failures++; printf("FAIL: %s\n", what); } } while (0)

// Something like speech at 16 kHz: a few harmonics of a changing pitch, loudness rising and falling like words.
static int16_t speech(long n) {
  double t = n / 16000.0;
  double f0 = 120 + 25 * sin(t * 3.1);
  double env = 0.5 + 0.5 * sin(t * 5.3);
  double v = 0;
  for (int h = 1; h <= 8; h++) v += sin(2 * M_PI * f0 * h * t) / h;
  return (int16_t)(6000 * env * v);
}

// The usual IMA decoder, to measure how well the sound survives.
static void decodeBlock(const uint8_t *b, int16_t *out) {
  int pred = (int16_t)(b[0] | (b[1] << 8)), index = b[2];
  out[0] = pred;
  for (int i = 0; i < 1000; i++) {
    int nib = (i & 1) ? (b[4 + i / 2] >> 4) : (b[4 + i / 2] & 15);
    int step = RecStepTable[index], vp = ((2 * (nib & 7) + 1) * step) >> 3;
    pred += (nib & 8) ? -vp : vp;
    if (pred > 32767) pred = 32767;
    if (pred < -32768) pred = -32768;
    index += RecIndexTable[nib & 7];
    if (index < 0) index = 0;
    if (index > 88) index = 88;
    out[1 + i] = pred;
  }
}

int main(int argc, char **argv) {
  // 1. Ten seconds: 3 s of "speech", 4 s of quiet, 3 s of "speech".
  RecIO io = makeIO(1 << 20);
  Rec r;
  CHECK(recStart(r, io, 0xBEEF1234u, 1794262500u), "a recording starts");
  std::vector<int16_t> chunk(320);
  long n = 0;
  for (int block = 0; block < 500; block++) {                       // 500 x 20 ms
    for (int i = 0; i < 320; i++, n++) {
      double sec = n / 16000.0;
      bool talking = sec < 3.0 || sec >= 7.0;
      chunk[i] = talking ? speech(n) : (int16_t)((n * 7919) % 41 - 20);   // quiet: faint noise
    }
    recFeed16k(r, chunk.data(), 320);
  }
  CHECK(recElapsedSeconds(r) == 10, "ten seconds are counted");
  CHECK(r.slots > 40 && r.slots < 70, "speech is stored, the quiet stretch mostly isn't");
  CHECK(r.skipped > 20, "quiet slots are skipped");
  printf("10 s: %u slots stored, %u skipped, %u erases\n", r.slots, r.skipped, (unsigned)erases);
  CHECK(recStop(r), "stopping stores the end mark");
  RecFound f = recLook(io);
  CHECK(f.present && !f.sent && f.slots == r.slots, "after stopping, the partition says what it holds");
  CHECK(f.ms >= 9900 && f.ms <= 10100, "and how long it was");
  CHECK(f.id == 0xBEEF1234u && f.startedUtc == 1794262500u, "and who it is");
  CHECK(violations == 0, "no bit was ever set back to 1 (real flash can't)");

  // 2. The sound survives: decode every stored slot and compare with the same sound taken down to 8 kHz directly.
  double sig = 0, err = 0; long compared = 0;
  for (uint32_t s = 0; s < f.slots; s++) {
    const uint8_t *slot = &flash[REC_SECTOR + s * REC_SLOT];
    int16_t pcm[REC_SLOT_SAMPLES]; decodeBlock(slot + REC_SLOT_HEAD, pcm);
    uint32_t at = recGet32(slot + 4);                                    // the sample this slot began at (8 kHz)
    long start = at; uint32_t ms = (uint32_t)((uint64_t)at * 1000 / REC_RATE);
    for (int i = 0; i < REC_SLOT_SAMPLES; i += 1) {
      long k = (start + i) * 2 + 1;                                    // the 16 kHz sample it came from (every second one is kept, from the second)
      int x0 = speech(k - 2), x1 = speech(k - 1), x2 = speech(k);
      double want = (x0 + 2 * x1 + x2) / 4.0;
      double got = pcm[i];
      if (ms > 100 && ms < 2800) { sig += want * want; err += (got - want) * (got - want); compared++; }
    }
  }
  double snr = 10 * log10(sig / (err + 1));
  printf("sound check: %ld samples, %.1f dB signal-to-noise\n", compared, snr);
  CHECK(compared > 10000 && snr > 18.0, "speech survives the 4-bit codec with a clear margin");

  // 3. Power lost: no end mark was written. A fresh look finds the slots by their ids.
  RecIO io2 = makeIO(1 << 20);
  Rec r2; recStart(r2, io2, 0x1234ABCDu, 1794262600u);
  for (int block = 0; block < 200; block++) {
    for (int i = 0; i < 320; i++) chunk[i] = speech(n + block * 320 + i);
    recFeed16k(r2, chunk.data(), 320);
  }
  RecFound lost = recLook(io2);
  CHECK(lost.present && lost.slots == r2.slots && lost.slots > 20, "after a power loss the slots are found by their ids");
  // An older recording's slots further on don't confuse it: record, then record again over it with a different id.
  RecIO io3 = makeIO(1 << 20);
  Rec a; recStart(a, io3, 0x1111u, 1);
  for (int block = 0; block < 500; block++) { for (int i = 0; i < 320; i++) chunk[i] = speech(block * 320 + i); recFeed16k(a, chunk.data(), 320); }
  recStop(a);
  Rec b; recStart(b, io3, 0x2222u, 2);
  for (int block = 0; block < 100; block++) { for (int i = 0; i < 320; i++) chunk[i] = speech(block * 320 + i); recFeed16k(b, chunk.data(), 320); }
  RecFound second = recLook(io3);
  CHECK(second.id == 0x2222u && second.slots == b.slots && second.slots < a.slots, "a newer recording isn't mixed up with an older one's leftovers");

  // 4. A full partition stops cleanly.
  RecIO small = makeIO(REC_SECTOR + 40 * REC_SLOT + 100);
  Rec c; recStart(c, small, 7, 3);
  for (int block = 0; block < 500; block++) { for (int i = 0; i < 320; i++) chunk[i] = speech(block * 320 + i); recFeed16k(c, chunk.data(), 320); }
  CHECK(c.full && c.slots == 40 && !c.failed, "a full partition stops storing without any fault");
  CHECK(recSecondsLeft(c) == 0, "and says there is no time left");
  CHECK(recStop(c), "and still ends properly");

  // 5. How much fits on the real partition (0x19F0000 bytes).
  RecIO real = RecIO{ nullptr, nullptr, nullptr, 0x19F0000 };
  printf("the real partition holds %u slots = %u s (%.2f h) of nonstop speech\n", recSlotCapacity(real), recCapacitySeconds(real), recCapacitySeconds(real) / 3600.0);
  CHECK(recCapacitySeconds(real) > 6600, "over an hour and three quarters of nonstop speech fits (more with pauses)");

  CHECK(violations == 0, "still no bit set back to 1");
  if (argc > 1) {                                                      // what the first recording stored, for the server's test
    RecIO again = makeIO(1 << 20);                                  // (the same recording again, into fresh flash)
    Rec d; recStart(d, again, 0xBEEF1234u, 1794262500u); long m = 0;
    for (int block = 0; block < 500; block++) {
      for (int i = 0; i < 320; i++, m++) { double sec = m / 16000.0; bool talking = sec < 3.0 || sec >= 7.0; chunk[i] = talking ? speech(m) : (int16_t)((m * 7919) % 41 - 20); }
      recFeed16k(d, chunk.data(), 320);
    }
    recStop(d);
    FILE *out = fopen(argv[1], "wb");
    if (out) { fwrite(flash.data(), 1, REC_SECTOR + (size_t)d.slots * REC_SLOT, out); fclose(out); }
  }
  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
