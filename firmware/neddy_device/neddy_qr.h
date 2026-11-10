// A small QR code maker for the watch's screen: text in, a square of dark and light dots out. No libraries, no memory allocation, so a
// computer can test it (firmware/tools/qr_test.cpp decodes what it makes with a real QR reader).
//
// What it does: byte mode (any text), error correction level M (about 15% of the code can be damaged and it still reads), versions 1 to 6
// (21 to 41 dots square, text up to 106 bytes). That is plenty for a Wi-Fi join code (about 55 bytes) and a short web address.
// The method is the standard one in ISO/IEC 18004 (data bits, Reed-Solomon error correction over GF(256), interleaved blocks, function
// patterns, the best of the eight masks by the standard's four penalty rules).
#pragma once
#include <stdint.h>
#include <string.h>

#define QR_MAX_VERSION 6
#define QR_MAX_SIZE (4 * QR_MAX_VERSION + 17)

struct QrCode {
  int size;                                   // dots on a side (0 = nothing made)
  uint8_t dark[QR_MAX_SIZE * QR_MAX_SIZE];    // 1 = dark dot, row by row
  uint8_t fixed[QR_MAX_SIZE * QR_MAX_SIZE];   // working: 1 = part of a fixed pattern (not data)
};

// Data codewords, error-correction codewords per block and number of blocks, level M, versions 1..6.
static const uint8_t QR_DATA_WORDS[7] = { 0, 16, 28, 44, 64, 86, 108 };
static const uint8_t QR_ECC_PER_BLOCK[7] = { 0, 10, 16, 26, 18, 24, 16 };
static const uint8_t QR_BLOCKS[7] = { 0, 1, 1, 1, 2, 2, 4 };

static inline int qrGet(const QrCode &q, int x, int y) { return q.dark[y * q.size + x]; }
static inline void qrSet(QrCode &q, int x, int y, int v) { q.dark[y * q.size + x] = (uint8_t)v; }
static inline void qrFixed(QrCode &q, int x, int y, int v) { q.dark[y * q.size + x] = (uint8_t)v; q.fixed[y * q.size + x] = 1; }

static uint8_t qrMul(uint8_t a, uint8_t b) {   // multiply in GF(256), polynomial 0x11D
  int r = 0;
  for (int i = 7; i >= 0; i--) { r = (r << 1) ^ ((r >> 7) * 0x11D); r ^= ((b >> i) & 1) * a; }
  return (uint8_t)r;
}

// The error-correction codewords for one block of data.
static void qrEcc(const uint8_t *data, int dataLen, int eccLen, uint8_t *out) {
  uint8_t gen[32];
  memset(gen, 0, sizeof(gen)); gen[eccLen - 1] = 1;
  uint8_t root = 1;
  for (int i = 0; i < eccLen; i++) {            // multiply (x - alpha^i) in
    for (int j = 0; j < eccLen; j++) { gen[j] = qrMul(gen[j], root); if (j + 1 < eccLen) gen[j] ^= gen[j + 1]; }
    root = qrMul(root, 0x02);
  }
  memset(out, 0, eccLen);
  for (int i = 0; i < dataLen; i++) {
    uint8_t factor = data[i] ^ out[0];
    memmove(out, out + 1, eccLen - 1); out[eccLen - 1] = 0;
    for (int j = 0; j < eccLen; j++) out[j] ^= qrMul(gen[j], factor);
  }
}

static int qrRawModules(int v) {                 // dots that can hold data and error correction (all but the fixed patterns)
  int r = (16 * v + 128) * v + 64;
  if (v >= 2) { int a = v / 7 + 2; r -= (25 * a - 10) * a - 55; }
  return r;
}

static void qrFormatBits(QrCode &q, int mask) {  // level M is 0
  int data = (0 << 3) | mask, rem = data;
  for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  int bits = ((data << 10) | rem) ^ 0x5412;
  const int n = q.size;
  for (int i = 0; i <= 5; i++) qrFixed(q, 8, i, (bits >> i) & 1);
  qrFixed(q, 8, 7, (bits >> 6) & 1);
  qrFixed(q, 8, 8, (bits >> 7) & 1);
  qrFixed(q, 7, 8, (bits >> 8) & 1);
  for (int i = 9; i < 15; i++) qrFixed(q, 14 - i, 8, (bits >> i) & 1);
  for (int i = 0; i < 8; i++) qrFixed(q, n - 1 - i, 8, (bits >> i) & 1);
  for (int i = 8; i < 15; i++) qrFixed(q, 8, n - 15 + i, (bits >> i) & 1);
  qrFixed(q, 8, n - 8, 1);                       // the one always-dark dot
}

static void qrFinder(QrCode &q, int cx, int cy) {
  for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
    int x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= q.size || y >= q.size) continue;
    int d = (dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy) ? (dx < 0 ? -dx : dx) : (dy < 0 ? -dy : dy);
    qrFixed(q, x, y, d != 2 && d != 4);
  }
}
static void qrAlign(QrCode &q, int cx, int cy) {
  for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
    int d = (dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy) ? (dx < 0 ? -dx : dx) : (dy < 0 ? -dy : dy);
    qrFixed(q, cx + dx, cy + dy, d != 1);
  }
}

static bool qrMaskFlips(int mask, int x, int y) {
  switch (mask) {
    case 0: return (x + y) % 2 == 0;
    case 1: return y % 2 == 0;
    case 2: return x % 3 == 0;
    case 3: return (x + y) % 3 == 0;
    case 4: return (x / 3 + y / 2) % 2 == 0;
    case 5: return x * y % 2 + x * y % 3 == 0;
    case 6: return (x * y % 2 + x * y % 3) % 2 == 0;
    default: return ((x + y) % 2 + x * y % 3) % 2 == 0;
  }
}
static void qrApplyMask(QrCode &q, int mask) {   // flipping twice undoes it
  for (int y = 0; y < q.size; y++) for (int x = 0; x < q.size; x++)
    if (!q.fixed[y * q.size + x] && qrMaskFlips(mask, x, y)) q.dark[y * q.size + x] ^= 1;
}

// The standard's four penalty rules: long runs, 2x2 blocks, finder-like patterns, and too many dark or light dots.
static int qrPenalty(const QrCode &q) {
  const int n = q.size;
  int score = 0;
  for (int pass = 0; pass < 2; pass++) {         // rows, then columns
    for (int a = 0; a < n; a++) {
      int run = 1;
      for (int b = 1; b < n; b++) {
        int cur = pass ? qrGet(q, a, b) : qrGet(q, b, a), prev = pass ? qrGet(q, a, b - 1) : qrGet(q, b - 1, a);
        if (cur == prev) { run++; if (run == 5) score += 3; else if (run > 5) score++; } else run = 1;
      }
      for (int b = 0; b + 11 <= n; b++) {        // 1:1:3:1:1 with four light dots on one side
        static const uint8_t p1[11] = { 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0 }, p2[11] = { 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1 };
        bool m1 = true, m2 = true;
        for (int k = 0; k < 11; k++) {
          int v = pass ? qrGet(q, a, b + k) : qrGet(q, b + k, a);
          if (v != p1[k]) m1 = false;
          if (v != p2[k]) m2 = false;
        }
        if (m1) score += 40;
        if (m2) score += 40;
      }
    }
  }
  for (int y = 0; y + 1 < n; y++) for (int x = 0; x + 1 < n; x++) {
    int c = qrGet(q, x, y);
    if (c == qrGet(q, x + 1, y) && c == qrGet(q, x, y + 1) && c == qrGet(q, x + 1, y + 1)) score += 3;
  }
  int dark = 0;
  for (int i = 0; i < n * n; i++) dark += q.dark[i];
  int k = (dark * 20 - n * n * 10) < 0 ? -(dark * 20 - n * n * 10) : (dark * 20 - n * n * 10);
  k = (k + n * n - 1) / (n * n) - 1;             // steps of 5% away from half
  if (k > 0) score += k * 10;
  return score;
}

// Makes the code for `text`. False when the text is too long (over 106 bytes). The finished code is in q.dark (q.size dots square).
static bool qrEncode(QrCode &q, const char *text) {
  const int len = (int)strlen(text);
  int v = 1;
  while (v <= QR_MAX_VERSION && len > QR_DATA_WORDS[v] - 2) v++;
  if (v > QR_MAX_VERSION) { q.size = 0; return false; }
  const int dataWords = QR_DATA_WORDS[v], eccLen = QR_ECC_PER_BLOCK[v], blocks = QR_BLOCKS[v];
  uint8_t data[108];
  memset(data, 0, sizeof(data));
  int bitPos = 0;
  auto put = [&](uint32_t value, int count) { for (int i = count - 1; i >= 0; i--) { if ((value >> i) & 1) data[bitPos >> 3] |= (uint8_t)(0x80 >> (bitPos & 7)); bitPos++; } };
  put(4, 4);                                      // byte mode
  put((uint32_t)len, 8);
  for (int i = 0; i < len; i++) put((uint8_t)text[i], 8);
  int room = dataWords * 8 - bitPos;
  put(0, room < 4 ? room : 4);                    // end of data
  bitPos = (bitPos + 7) & ~7;
  for (int pad = 0xEC; (bitPos >> 3) < dataWords; pad ^= 0xEC ^ 0x11) { data[bitPos >> 3] = (uint8_t)pad; bitPos += 8; }

  // Split into blocks, add error correction, interleave.
  const int raw = qrRawModules(v) / 8;
  const int shortBlocks = blocks - raw % blocks, shortLen = raw / blocks;
  uint8_t all[256];
  int allN = 0;
  uint8_t eccs[4][16];
  const uint8_t *blockData[4];
  int blockLen[4];
  int at = 0;
  for (int b = 0; b < blocks; b++) {
    int dl = shortLen - eccLen + (b < shortBlocks ? 0 : 1);
    blockData[b] = data + at; blockLen[b] = dl; at += dl;
    qrEcc(blockData[b], dl, eccLen, eccs[b]);
  }
  for (int i = 0; i < shortLen - eccLen + 1; i++)
    for (int b = 0; b < blocks; b++)
      if (i != shortLen - eccLen || b >= shortBlocks) all[allN++] = blockData[b][i];
  for (int i = 0; i < eccLen; i++) for (int b = 0; b < blocks; b++) all[allN++] = eccs[b][i];

  // The fixed patterns.
  const int n = 4 * v + 17;
  q.size = n;
  memset(q.dark, 0, sizeof(q.dark)); memset(q.fixed, 0, sizeof(q.fixed));
  for (int i = 0; i < n; i++) { qrFixed(q, 6, i, i % 2 == 0); qrFixed(q, i, 6, i % 2 == 0); }
  qrFinder(q, 3, 3); qrFinder(q, n - 4, 3); qrFinder(q, 3, n - 4);
  if (v >= 2) {
    static const uint8_t alignAt[7] = { 0, 0, 18, 22, 26, 30, 34 };
    qrAlign(q, alignAt[v], alignAt[v]);           // (one in the corner away from the finders, for these small versions)
  }
  qrFormatBits(q, 0);                              // reserve the format dots (drawn again with the real mask below)

  // Data, in the standard's zigzag from the bottom right.
  int bit = 0;
  for (int right = n - 1; right >= 1; right -= 2) {
    if (right == 6) right = 5;
    for (int vert = 0; vert < n; vert++) {
      for (int j = 0; j < 2; j++) {
        int x = right - j;
        bool upward = ((right + 1) & 2) == 0;
        int y = upward ? n - 1 - vert : vert;
        if (!q.fixed[y * n + x]) {
          int on = bit < allN * 8 ? (all[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
          q.dark[y * n + x] = (uint8_t)on; bit++;
        }
      }
    }
  }

  // The best of the eight masks.
  int best = 0, bestScore = 0x7FFFFFFF;
  for (int m = 0; m < 8; m++) {
    qrApplyMask(q, m); qrFormatBits(q, m);
    int s = qrPenalty(q);
    if (s < bestScore) { bestScore = s; best = m; }
    qrApplyMask(q, m);
  }
  qrApplyMask(q, best); qrFormatBits(q, best);
  return true;
}
