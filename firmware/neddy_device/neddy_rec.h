// Neddy's recorder: speech is squeezed into IMA ADPCM (4 bits a sample at 8 kHz, about 4 KB a second) and written, as it is
// spoken, into a flash partition called "rec". Nothing here touches the Arduino or the chip, so a computer can test all of it
// (see firmware/tools/rec_test.cpp): flash is reached through three small functions the sketch (or the test) provides.
//
// What is stored:
//   sector 0 (4096 bytes): a header: "NRC1", version, when it started (UTC seconds), an id; later an end mark ("END!", length in ms,
//                          slots written) and, once the server has everything, "SENT". Bits are only ever cleared, never rewritten.
//   from byte 4096: 512-byte slots, one after another:  2 bytes 0xA7 0x5C, 2 bytes recording id, 4 bytes: the sample (at 8 kHz) it starts at,
//                          then one IMA ADPCM block of 504 bytes (4-byte block header + 500 bytes = 1,001 samples = 125 ms).
//   Quiet stretches are not stored (a slot is skipped when nothing was said); the sample positions let the server put the silence back.
// The same layout is read by apps/server/src/device-recordings.ts.
#pragma once
#include <stdint.h>
#include <string.h>

#define REC_SECTOR 4096
#define REC_SLOT 512
#define REC_SLOT_HEAD 8
#define REC_BLOCK 504                         // an IMA block: 4 header bytes + 500 data bytes
#define REC_SLOT_SAMPLES 1001                 // samples in one block (the first one is in the block header)
#define REC_RATE 8000
#ifndef REC_SILENCE_PEAK
#define REC_SILENCE_PEAK 140                  // a slot whose loudest sample stays under this (and the one before) isn't stored
#endif
#define REC_HANG_SLOTS 4                      // after speech, keep this many quiet slots (half a second) so word ends aren't clipped
#define REC_HEADER_MAGIC 0x3143524Eu          // "NRC1" little-endian
#define REC_END_MAGIC 0x21444E45u             // "END!"
#define REC_SENT_MAGIC 0x544E4553u            // "SENT"

// Where bytes go: erase a range (sector aligned), write bytes (only clears bits, like real flash), read bytes. Return true on success.
struct RecIO {
  bool (*erase)(uint32_t offset, uint32_t length);
  bool (*write)(uint32_t offset, const uint8_t *data, uint32_t length);
  bool (*read)(uint32_t offset, uint8_t *data, uint32_t length);
  uint32_t size;                              // the partition's size in bytes
};

static const int16_t RecStepTable[89] = {
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157,
  173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767 };
static const int8_t RecIndexTable[8] = { -1, -1, -1, -1, 2, 4, 6, 8 };

struct RecAdpcm { int pred; int index; };

static inline uint8_t recEncodeSample(RecAdpcm &s, int sample) {
  const int step0 = RecStepTable[s.index];
  int step = step0;
  int diff = sample - s.pred;
  uint8_t code = 0;
  if (diff < 0) { code = 8; diff = -diff; }
  if (diff >= step) { code |= 4; diff -= step; }
  step >>= 1;
  if (diff >= step) { code |= 2; diff -= step; }
  step >>= 1;
  if (diff >= step) { code |= 1; }
  // What the decoder will make of this code: ffmpeg's formula ((2 x code + 1) x step) / 8, so every decoder agrees with the encoder.
  const int vpdiff = ((2 * (code & 7) + 1) * step0) >> 3;
  s.pred += (code & 8) ? -vpdiff : vpdiff;
  if (s.pred > 32767) s.pred = 32767;
  if (s.pred < -32768) s.pred = -32768;
  s.index += RecIndexTable[code & 7];
  if (s.index < 0) s.index = 0;
  if (s.index > 88) s.index = 88;
  return code;
}

struct Rec {
  RecIO io;
  bool running;
  bool full;                                  // the partition is full: nothing more can be stored
  bool failed;                                // flash refused a write or erase
  uint32_t id;                                // this recording's id
  uint32_t startedUtc;
  uint32_t nextOff;                           // where the next slot goes
  uint32_t erasedTo;                          // everything below this has been erased
  uint32_t slots;                             // slots stored
  uint32_t skipped;                           // quiet slots left out
  uint64_t samples;                           // 8 kHz samples taken in so far
  int16_t block[REC_SLOT_SAMPLES];            // the samples of the slot being filled
  int filled;
  int peak;                                   // the loudest sample in this slot
  int hang;                                   // slots still to keep after speech
  int lp0, lp1;                               // the low-pass filter's memory (the last two input samples at 16 kHz)
  bool half;                                  // the decimator is on the second of each pair of samples
};

static uint32_t recSlotCapacity(const RecIO &io) { return io.size > REC_SECTOR ? (io.size - REC_SECTOR) / REC_SLOT : 0; }
// How many seconds of nonstop speech fit (quiet stretches take no room, so a real meeting lasts longer).
static uint32_t recCapacitySeconds(const RecIO &io) { return (uint32_t)((uint64_t)recSlotCapacity(io) * REC_SLOT_SAMPLES / REC_RATE); }

static bool recErasePast(Rec &r, uint32_t upTo) {                           // erases sectors until `upTo` bytes are ready
  while (r.erasedTo < upTo) {
    if (r.erasedTo + REC_SECTOR > r.io.size) return false;
    if (!r.io.erase(r.erasedTo, REC_SECTOR)) { r.failed = true; return false; }
    r.erasedTo += REC_SECTOR;
  }
  return true;
}

static void recPut32(uint8_t *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static uint32_t recGet32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

// Starts a recording: clears the header sector, writes the header. `id` makes this recording's slots recognisable (old ones aren't).
static bool recStart(Rec &r, const RecIO &io, uint32_t id, uint32_t utc) {
  memset(&r, 0, sizeof(r));
  r.io = io; r.id = id ? id : 1; r.startedUtc = utc;
  if (!io.erase(0, REC_SECTOR)) { r.failed = true; return false; }
  uint8_t head[16];
  recPut32(head, REC_HEADER_MAGIC); recPut32(head + 4, 1); recPut32(head + 8, utc); recPut32(head + 12, r.id);
  if (!io.write(0, head, 16)) { r.failed = true; return false; }
  r.erasedTo = REC_SECTOR; r.nextOff = REC_SECTOR; r.running = true;
  return true;
}

// Makes the slot in r.block into 512 bytes and stores it (or leaves it out when it was quiet).
static void recFlushSlot(Rec &r, int count) {
  uint32_t startAt = (uint32_t)(r.samples - (uint64_t)count);          // the sample this slot starts at (8 kHz, from the start)
  bool loud = r.peak >= REC_SILENCE_PEAK;
  if (loud) r.hang = REC_HANG_SLOTS; else if (r.hang > 0) r.hang--; else { r.skipped++; r.filled = 0; r.peak = 0; return; }
  if (r.full || r.failed || r.nextOff + REC_SLOT > r.io.size) { r.full = true; r.filled = 0; r.peak = 0; return; }
  uint8_t slot[REC_SLOT];
  memset(slot, 0, sizeof(slot));
  slot[0] = 0xA7; slot[1] = 0x5C; slot[2] = r.id; slot[3] = r.id >> 8; recPut32(slot + 4, startAt);
  uint8_t *b = slot + REC_SLOT_HEAD;
  while (count < REC_SLOT_SAMPLES) r.block[count++] = 0;       // a short last slot is padded with silence
  RecAdpcm st; st.pred = r.block[0]; st.index = 0;
  // The index starts at a step that fits the loudness of the first samples, so the first words aren't smeared.
  int a = 0; for (int i = 1; i < 16; i++) { int d = r.block[i] - r.block[i - 1]; a += d < 0 ? -d : d; }
  a /= 15; while (st.index < 88 && RecStepTable[st.index] * 2 < a) st.index++;
  b[0] = st.pred; b[1] = st.pred >> 8; b[2] = st.index; b[3] = 0;
  for (int i = 0; i < 500; i++) {                                // 1,000 samples, two to a byte, the earlier one in the low half
    uint8_t lo = recEncodeSample(st, r.block[1 + 2 * i]);
    uint8_t hi = recEncodeSample(st, r.block[2 + 2 * i]);
    b[4 + i] = lo | (hi << 4);
  }
  if (!recErasePast(r, r.nextOff + REC_SLOT)) { r.full = r.full || !r.failed; r.filled = 0; r.peak = 0; return; }
  if (!r.io.write(r.nextOff, slot, REC_SLOT)) { r.failed = true; r.filled = 0; r.peak = 0; return; }
  r.nextOff += REC_SLOT; r.slots++;
  r.filled = 0; r.peak = 0;
}

// Takes in 16 kHz mono sound: a gentle low-pass (1-2-1), keep every second sample, fill slots. Call as often as sound arrives.
static void recFeed16k(Rec &r, const int16_t *in, int frames) {
  if (!r.running) return;
  for (int i = 0; i < frames; i++) {
    int x = in[i];
    int y = (r.lp0 + 2 * r.lp1 + x) / 4;                          // 1-2-1 over the last three samples
    r.lp0 = r.lp1; r.lp1 = x;
    r.half = !r.half;
    if (r.half) continue;                                          // every second one is kept: 8 kHz
    r.block[r.filled++] = (int16_t)y;
    int ay = y < 0 ? -y : y; if (ay > r.peak) r.peak = ay;
    r.samples++;
    if (r.filled == REC_SLOT_SAMPLES) recFlushSlot(r, REC_SLOT_SAMPLES);
  }
}

// How long it has been recording, in whole seconds, and how many seconds of nonstop speech are left.
static uint32_t recElapsedSeconds(const Rec &r) { return (uint32_t)(r.samples / REC_RATE); }
static uint32_t recSecondsLeft(const Rec &r) {
  uint32_t cap = recSlotCapacity(r.io);
  return r.slots >= cap ? 0 : (uint32_t)((uint64_t)(cap - r.slots) * REC_SLOT_SAMPLES / REC_RATE);
}

// Ends the recording: the last partial slot is stored and the end mark is written. Returns true when everything is safely stored.
static bool recStop(Rec &r) {
  if (!r.running) return false;
  if (r.filled > 100) { r.peak = REC_SILENCE_PEAK; recFlushSlot(r, r.filled); }
  r.running = false;
  uint8_t end[12];
  recPut32(end, REC_END_MAGIC); recPut32(end + 4, (uint32_t)(r.samples * 1000ULL / REC_RATE)); recPut32(end + 8, r.slots);
  return !r.failed && r.io.write(64, end, 12);
}

// What the partition holds after a power cycle.
struct RecFound {
  bool present;                               // a recording is there
  bool sent;                                  // the server already has it
  uint32_t id, startedUtc, slots, ms;         // ms: its length
  uint32_t bytes;                             // slot bytes stored (slots * 512)
};

static bool recSlotValid(const RecIO &io, uint32_t slot, uint32_t id) {
  uint8_t h[8];
  if (!io.read(REC_SECTOR + slot * REC_SLOT, h, 8)) return false;
  return h[0] == 0xA7 && h[1] == 0x5C && (uint16_t)(h[2] | (h[3] << 8)) == (uint16_t)id;
}

static RecFound recLook(const RecIO &io) {
  RecFound f; memset(&f, 0, sizeof(f));
  uint8_t h[16], end[12], sent[4];
  if (!io.read(0, h, 16) || recGet32(h) != REC_HEADER_MAGIC) return f;
  f.present = true; f.startedUtc = recGet32(h + 8); f.id = recGet32(h + 12);
  if (io.read(128, sent, 4) && recGet32(sent) == REC_SENT_MAGIC) f.sent = true;
  if (io.read(64, end, 12) && recGet32(end) == REC_END_MAGIC) { f.ms = recGet32(end + 4); f.slots = recGet32(end + 8); }
  else {                                                         // no end mark (the power went): find where the slots stop
    uint32_t lo = 0, hi = recSlotCapacity(io);
    while (lo < hi) { uint32_t mid = (lo + hi) / 2; if (recSlotValid(io, mid, f.id)) lo = mid + 1; else hi = mid; }
    f.slots = lo;
    uint8_t last[8];
    if (lo > 0 && io.read(REC_SECTOR + (lo - 1) * REC_SLOT, last, 8)) f.ms = (uint32_t)(((uint64_t)recGet32(last + 4) + REC_SLOT_SAMPLES) * 1000ULL / REC_RATE);
  }
  f.bytes = f.slots * REC_SLOT;
  return f;
}

static bool recMarkSent(const RecIO &io) { uint8_t m[4]; recPut32(m, REC_SENT_MAGIC); return io.write(128, m, 4); }
