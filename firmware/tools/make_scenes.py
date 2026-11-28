#!/usr/bin/env python3
"""
Neddy's animated scenes for the watch (firmware/art/scenes/*.mp4 -> firmware/neddy_device/neddy_scenes.h).

Each 4-second loop becomes FPS small JPEG frames (W x H, baseline, decoded on the watch by neddy_jpg.c): cropped to the box Neddy
fills over the whole clip, edges faded into the AMOLED's black (some clips cut through the umbrella), near-black made true black.
Usage (from the repo root; needs ffmpeg, Pillow, numpy):
    python3 firmware/tools/make_scenes.py
It prints each scene's frame count and size; the total must stay well inside the program space (app0 is 6 MB, the rest of the
program is about 2.5 MB).
"""
import glob, io, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ART = os.path.join(ROOT, 'firmware', 'art', 'scenes')
OUT = os.path.join(ROOT, 'firmware', 'neddy_device', 'neddy_scenes.h')
W, H, FPS, QUALITY = 104, 138, 12, 86
# The order is the firmware's scene numbers (SC_* in neddy_scene.h).
SCENES = ['reporter', 'note', 'idea', 'dream', 'rain', 'cold', 'hot', 'sunny']
FADE = 10        # pixels of fade into black at the left, right and top edges (6 at the bottom: the feet stand near it)

def frames(path):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'fps={FPS}', os.path.join(d, 'f_%03d.png')], check=True)
        fs = [np.asarray(Image.open(p).convert('RGB')).astype(np.float32) for p in sorted(glob.glob(os.path.join(d, '*.png')))]
    # A seamless loop starts and ends on the same picture: drop a last frame that repeats the first.
    if len(fs) > 2 and np.abs(fs[-1] - fs[0]).mean() < 4: fs = fs[:-1]
    return fs

def box(fs):
    lit = np.zeros(fs[0].shape[:2], bool)
    for f in fs: lit |= f.max(axis=2) > 40
    ys, xs = np.where(lit)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bw, bh = (x1 - x0) * 1.08, (y1 - y0) * 1.06          # a little room round him
    if bw / bh > W / H: bh = bw * H / W
    else: bw = bh * W / H
    return cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2

def fade_mask():
    m = np.ones((H, W), np.float32)
    for i in range(FADE):
        a = (i + 0.5) / FADE
        m[:, i] *= a; m[:, W - 1 - i] *= a; m[i, :] *= a
    for i in range(6): m[H - 1 - i, :] *= (i + 0.5) / 6
    return m[..., None]

def shrink(f, b):
    h, w = f.shape[:2]
    pad = 200                                             # the box can run past the clip: pad with black first
    big = np.zeros((h + 2 * pad, w + 2 * pad, 3), np.float32); big[pad:pad + h, pad:pad + w] = f
    im = Image.fromarray(big.clip(0, 255).astype(np.uint8)).crop(tuple(int(round(v + pad)) for v in b))
    return np.asarray(im.resize((W, H), Image.LANCZOS)).astype(np.float32)

def jpeg(a):
    a = a.copy(); a[a.max(axis=2) < 14] = 0              # the AMOLED's true black (no glowing grey box)
    buf = io.BytesIO()
    Image.fromarray(a.clip(0, 255).astype(np.uint8)).save(buf, 'JPEG', quality=QUALITY, subsampling=0, optimize=True, progressive=False)
    return buf.getvalue()

def main():
    mask = fade_mask()
    data, offs, table = bytearray(), [], []
    for name in SCENES:
        fs = frames(os.path.join(ART, name + '.mp4'))
        b = box(fs)
        first = len(offs)
        for f in fs:
            offs.append(len(data)); data += jpeg(shrink(f, b) * mask)
        table.append((name, first, len(fs)))
        print(f'{name:9s} {len(fs):3d} frames  {(len(data) - offs[first]) / 1024:7.1f} KB')
    offs.append(len(data))
    print(f'total {len(data) / 1024:.1f} KB in {len(offs) - 1} frames')
    with open(OUT, 'w') as o:
        o.write('// Neddy\'s animated scenes: small baseline JPEG frames. Made by firmware/tools/make_scenes.py from firmware/art/scenes; do not edit.\n')
        o.write('#pragma once\n#include <stdint.h>\n')
        o.write(f'#define SC_W {W}\n#define SC_H {H}\n#define SC_FPS {FPS}\n#define SC_COUNT {len(SCENES)}\n')
        o.write('struct ScClip { const char *name; uint16_t first, count; };\n')
        o.write('static const ScClip SC_CLIPS[SC_COUNT] = {\n' + ''.join(f'  {{ "{n}", {a}, {c} }},\n' for n, a, c in table) + '};\n')
        o.write(f'static const uint32_t SC_OFF[{len(offs)}] = {{\n')
        for i in range(0, len(offs), 12): o.write('  ' + ', '.join(str(v) for v in offs[i:i + 12]) + ',\n')
        o.write('};\n')
        o.write(f'static const uint8_t SC_DATA[{len(data)}] = {{\n')
        for i in range(0, len(data), 32): o.write('  ' + ','.join(str(v) for v in data[i:i + 32]) + ',\n')
        o.write('};\n')
    print('wrote', OUT, f'({os.path.getsize(OUT) / 1e6:.1f} MB of source)')

if __name__ == '__main__':
    main()
