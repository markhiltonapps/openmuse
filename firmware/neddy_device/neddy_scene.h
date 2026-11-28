// Neddy's animated scenes (the pictures in neddy_scenes.h, made by firmware/tools/make_scenes.py) decoded one frame at a time
// into a small RGB565 picture for the screen. The UI (neddy_ui.h) decides where and when a scene plays; this only decodes.
// A frame is about 5 KB of JPEG and decodes in a few milliseconds, so it runs in the loop (no second task).
// The scenes' order (make_scenes.py): 0 reporter, 1 note, 2 idea, 3 dream, 4 rain, 5 cold, 6 hot, 7 sunny.
#pragma once
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "neddy_jpg.h"
#include "neddy_scenes.h"

struct ScDec { const uint8_t *p; size_t left; uint16_t *dst; };
static size_t scIn(NJDEC *jd, uint8_t *buf, size_t n) {
  ScDec *d = (ScDec *)jd->device;
  if (n > d->left) n = d->left;
  if (buf) memcpy(buf, d->p, n);
  d->p += n; d->left -= n;
  return n;
}
static int scOut(NJDEC *jd, void *bitmap, NJRECT *r) {
  ScDec *d = (ScDec *)jd->device;
  const uint16_t *src = (const uint16_t *)bitmap;
  int w = r->right - r->left + 1;
  for (int y = r->top; y <= r->bottom; y++) memcpy(d->dst + y * SC_W + r->left, src + (y - r->top) * w, w * 2);
  return 1;
}
// Memory: the decoder's working space (~3 KB plus 6 KB of Huffman tables, NJD_FASTDECODE 2) and the finished picture (28 KB).
// On the watch the sketch points scAlloc at the big PSRAM, so the chip's own small memory stays free for secure connections.
static void *(*scAlloc)(size_t) = nullptr;
#define SC_POOL 12288
static void *scPool = nullptr;
static uint16_t *scPicture = nullptr;
static bool scMemory() {
  if (scPool && scPicture) return true;
  void *(*a)(size_t) = scAlloc ? scAlloc : malloc;
  if (!scPool) scPool = a(SC_POOL);
  if (!scPicture) scPicture = (uint16_t *)a(SC_W * SC_H * 2);
  return scPool && scPicture;
}
// Decodes the frame of `clip` that is due `ms` into its loop into dst (SC_W x SC_H). False when it couldn't.
static bool scDecode(int clip, uint32_t ms, uint16_t *dst) {
  if (clip < 0 || clip >= SC_COUNT || !dst || !scMemory()) return false;
  const ScClip &c = SC_CLIPS[clip];
  int f = c.first + (int)((uint64_t)ms * SC_FPS / 1000 % c.count);
  ScDec d = { SC_DATA + SC_OFF[f], (size_t)(SC_OFF[f + 1] - SC_OFF[f]), dst };
  NJDEC jd;
  if (njd_prepare(&jd, scIn, scPool, SC_POOL, &d) != NJDR_OK) return false;
  if (jd.width != SC_W || jd.height != SC_H) return false;
  return njd_decomp(&jd, scOut, 0) == NJDR_OK;
}
// What the screen calls (UiOut::scene): the frame as a picture of its own, or nullptr. The picture is the screen's to change
// (it is decoded afresh each time).
static uint16_t *scFrame(int clip, uint32_t ms) {
  if (!scMemory()) return nullptr;
  return scDecode(clip, ms, scPicture) ? scPicture : nullptr;
}
