#!/usr/bin/env python3
"""
Makes the picture and font data the watch draws with (neddy_art.h, neddy_font.h next to neddy_device.ino).

  Needs: Pillow, numpy, scipy.   Run from the repo root:   python3 firmware/tools/make_neddy_art.py

  * the whole Neddy robot (apps/mobile/public/home/neddy-full.webp) on black, with the glowing eyes painted
    out of the visor so the watch can draw its own, in two sizes (full and half) as RGB565 pixels;
  * the eye expressions, drawn as a glow of light to be ADDED on top of the dark visor;
  * four smooth (anti-aliased) Inter fonts, ASCII only, as 8-bit coverage.
"""
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
from scipy import ndimage as ndi

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'firmware', 'neddy_device')
SRC = os.path.join(ROOT, 'apps', 'mobile', 'public', 'home', 'neddy-full.webp')
FONT_DIR = '/usr/share/fonts/opentype/inter'

BODY_W = 216                       # the full-size body, in pixels
CROP = (4, 4, 467, 640)            # trims the empty margin of the original (470 x 643)

# ------------------------------------------------------------------ the body, eyes painted out
def eyeless_body():
    im = Image.open(SRC).convert('RGBA')
    bg = Image.new('RGBA', im.size, (0, 0, 0, 255)); bg.alpha_composite(im)
    a = np.array(bg.convert('RGB')).astype(float)
    H, W = a.shape[:2]
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    dark = (R < 125) & (G < 100) & (B < 100)
    dark[260:] = False; dark[:90] = False
    lab, n = ndi.label(dark)
    sizes = ndi.sum(dark, lab, range(1, n + 1)); big = 1 + int(np.argmax(sizes))
    interior = ndi.binary_erosion(ndi.binary_fill_holes(lab == big), iterations=3)
    warm = (R - B > 70) & (R > 110)
    eyes = ndi.binary_dilation(warm & interior, iterations=14) & interior
    fit = interior & ~eyes
    ys, xs = np.where(fit)
    def feats(x, y):
        x = (x - W / 2) / W; y = (y - 170) / 170
        return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)
    coef = [np.linalg.lstsq(feats(xs.astype(float), ys.astype(float)), a[ys, xs, c], rcond=None)[0] for c in range(3)]
    inner = ndi.binary_erosion(interior, iterations=5)
    yy, xx = np.where(inner)
    Af = feats(xx.astype(float), yy.astype(float))
    patch = a.copy(); patch[yy, xx] = np.stack([Af @ coef[c] for c in range(3)], axis=-1)
    soft = ndi.gaussian_filter(inner.astype(float), 3.0)
    out = a * (1 - soft[..., None]) + patch * soft[..., None]
    img = Image.fromarray(out.clip(0, 255).astype('uint8')).crop(CROP)
    return img

def to565(img, dither=True):
    a = np.array(img.convert('RGB')).astype(float)
    h, w = a.shape[:2]
    if dither:
        bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 - 0.5
        t = np.tile(bayer, (h // 4 + 1, w // 4 + 1))[:h, :w]
        a[..., 0] += t * 8; a[..., 1] += t * 4; a[..., 2] += t * 8
    r = np.clip(np.round(a[..., 0] / 8), 0, 31).astype(np.uint16)
    g = np.clip(np.round(a[..., 1] / 4), 0, 63).astype(np.uint16)
    b = np.clip(np.round(a[..., 2] / 8), 0, 31).astype(np.uint16)
    return ((r << 11) | (g << 5) | b).astype(np.uint16)

# ------------------------------------------------------------------ the eyes (light added over the dark visor)
ORANGE = (255, 178, 66)
SPR_W, SPR_H = 120, 72
EYE_SEP = 112 * (BODY_W / 463.0)           # distance between the two eyes, in body pixels
EYE_CX = ((176 + 288) / 2 - CROP[0]) * (BODY_W / 463.0)
EYE_CY = (170 - CROP[1]) * (BODY_W / 463.0)
K = 0.74 * 0.927                            # eye size

def eye_sprite(kind, level=0.0):
    SS = 4
    Wd, Hd = SPR_W * SS, SPR_H * SS
    L = Image.new('RGB', (Wd, Hd), (0, 0, 0)); d = ImageDraw.Draw(L)
    cy0 = SPR_H / 2
    lx, rx = SPR_W / 2 - EYE_SEP / 2, SPR_W / 2 + EYE_SEP / 2
    def arc(cx, cy, w, t, lift=0):
        w *= K; t *= K; lift *= K
        d.arc([(cx - w / 2) * SS, (cy - w * 0.42 + lift) * SS, (cx + w / 2) * SS, (cy + w * 0.42 + lift) * SS], 200, 340, fill=ORANGE, width=max(1, int(t * SS)))
        for ang in (200, 340):
            ex = cx + (w / 2 - t / 2) * math.cos(math.radians(ang)); ey = cy + lift + (w * 0.42 - t / 2) * math.sin(math.radians(ang))
            d.ellipse([(ex - t / 2) * SS, (ey - t / 2) * SS, (ex + t / 2) * SS, (ey + t / 2) * SS], fill=ORANGE)
    def blob(cx, cy, w, h):
        w *= K; h *= K
        d.ellipse([(cx - w / 2) * SS, (cy - h / 2) * SS, (cx + w / 2) * SS, (cy + h / 2) * SS], fill=ORANGE)
    def bar(cx, cy, w, t):
        w *= K; t *= K
        d.rounded_rectangle([(cx - w / 2) * SS, (cy - t / 2) * SS, (cx + w / 2) * SS, (cy + t / 2) * SS], radius=t / 2 * SS, fill=ORANGE)
    if kind == 'happy':
        arc(lx, cy0 + 4 * K, 46, 9); arc(rx, cy0 + 4 * K, 46, 9)
    elif kind == 'speak':
        arc(lx, cy0 + 2 * K, 52, 10, lift=-3); arc(rx, cy0 + 2 * K, 52, 10, lift=-3)
    elif kind == 'blink':
        bar(lx, cy0 + 6 * K, 44, 6); bar(rx, cy0 + 6 * K, 44, 6)
    elif kind == 'wide':
        s = 1.0 + 0.35 * level
        for cx in (lx, rx):
            blob(cx, cy0, 36 * s, 46 * s)
            d.ellipse([(cx - 3.5 * K) * SS, (cy0 - 12 * s * K) * SS, (cx + 0.5 * K) * SS, (cy0 - 7 * s * K) * SS], fill=(255, 236, 190))
    elif kind == 'think':
        for cx in (lx + 7 * K, rx + 7 * K):
            blob(cx, cy0 - 3 * K, 26, 26)
            d.ellipse([(cx - 3 * K) * SS, (cy0 - 3 * K - 6 * K) * SS, (cx + 0.5 * K) * SS, (cy0 - 3 * K - 2 * K) * SS], fill=(255, 236, 190))
    elif kind == 'dim':
        bar(lx, cy0 + 4 * K, 36, 5); bar(rx, cy0 + 4 * K, 36, 5)
    core = L.resize((SPR_W, SPR_H), Image.LANCZOS)
    if kind == 'dim':
        core = Image.fromarray((np.array(core).astype(float) * 0.45).astype('uint8'))
    glow = core.filter(ImageFilter.GaussianBlur(6 * 0.927)); glow2 = core.filter(ImageFilter.GaussianBlur(2))
    out = ImageChops.add(ImageChops.add(core, glow.point(lambda v: int(v * 0.9))), glow2.point(lambda v: int(v * 0.5)))
    return out

EYES = [('happy', 0), ('speak', 0), ('blink', 0), ('wide0', 0), ('wide1', 1 / 3), ('wide2', 2 / 3), ('wide3', 1), ('think', 0), ('dim', 0)]

# ------------------------------------------------------------------ fonts
FONTS = [('title', 'SemiBold', 26, None), ('body', 'Regular', 19, None), ('mid', 'Medium', 16, None), ('small', 'Medium', 12, None),
         ('huge', 'SemiBold', 64, '0123456789 ')]   # huge: only the pairing code's digits

def bake_font(style, size, chars=None):
    f = ImageFont.truetype(os.path.join(FONT_DIR, f'Inter-{style}.otf'), size)
    asc, desc = f.getmetrics(); h = asc + desc
    adv, bits = [], []
    for code in range(32, 127):
        ch = chr(code)
        if chars is not None and ch not in chars:
            adv.append(0); bits.append(np.zeros(0, dtype=np.uint8)); continue
        a = max(1, int(round(f.getlength(ch))))
        im = Image.new('L', (a + 2, h), 0)
        ImageDraw.Draw(im).text((0, 0), ch, font=f, fill=255)
        arr = np.array(im)[:, :a]
        adv.append(a); bits.append(arr.flatten())
    return h, adv, bits

def c_array(name, values, per_line=16, kind='uint16_t', fmt='0x%04X'):
    lines = []
    for i in range(0, len(values), per_line):
        lines.append('  ' + ', '.join(fmt % int(v) for v in values[i:i + per_line]) + ',')
    return f'static const {kind} {name}[{len(values)}] PROGMEM = {{\n' + '\n'.join(lines) + '\n};\n'

def main():
    body = eyeless_body()
    bh = int(round(body.height * BODY_W / body.width))
    full = body.resize((BODY_W, bh), Image.LANCZOS)
    half = body.resize((BODY_W // 2, bh // 2), Image.LANCZOS)
    art = ['// Made by firmware/tools/make_neddy_art.py from apps/mobile/public/home/neddy-full.webp. Do not edit.\n',
           '#pragma once\n#include <stdint.h>\n#ifndef PROGMEM\n#define PROGMEM\n#endif\n',
           f'#define NEDDY_BODY_W {full.width}\n#define NEDDY_BODY_H {full.height}\n',
           f'#define NEDDY_HALF_W {half.width}\n#define NEDDY_HALF_H {half.height}\n',
           f'#define NEDDY_EYE_CX {EYE_CX:.2f}f\n#define NEDDY_EYE_CY {EYE_CY:.2f}f\n',
           f'#define NEDDY_SPR_W {SPR_W}\n#define NEDDY_SPR_H {SPR_H}\n#define NEDDY_EYE_KINDS {len(EYES)}\n']
    art.append('enum { ' + ', '.join('EYE_' + n.upper() for n, _ in EYES) + ' };\n')
    art.append(c_array('NEDDY_BODY', to_565 := to565(full).flatten()))
    art.append(c_array('NEDDY_HALF', to565(half).flatten()))
    sprites = []
    for name, lv in EYES:
        kind = 'wide' if name.startswith('wide') else name
        sprites.append(to565(eye_sprite(kind, lv), dither=False).flatten())
    art.append(c_array('NEDDY_EYES', np.concatenate(sprites)))
    open(os.path.join(OUT, 'neddy_art.h'), 'w').write(''.join(art))

    fh = ['// Made by firmware/tools/make_neddy_art.py (Inter, ASCII 32-126, 8-bit coverage). Do not edit.\n',
          '#pragma once\n#include <stdint.h>\n#ifndef PROGMEM\n#define PROGMEM\n#endif\n',
          'struct NeddyFont { uint8_t h; const uint8_t *adv; const uint32_t *off; const uint8_t *bits; };\n']
    names = []
    for name, style, size, chars in FONTS:
        h, adv, bits = bake_font(style, size, chars)
        offs = np.concatenate([[0], np.cumsum([len(b) for b in bits])]).astype(np.uint32)
        fh.append(c_array(f'FNT_{name}_adv', adv, kind='uint8_t', fmt='%d'))
        fh.append(c_array(f'FNT_{name}_off', offs, kind='uint32_t', fmt='%d'))
        fh.append(c_array(f'FNT_{name}_bits', np.concatenate(bits), kind='uint8_t', fmt='%d', per_line=24))
        fh.append(f'static const NeddyFont NFONT_{name.upper()} = {{ {h}, FNT_{name}_adv, FNT_{name}_off, FNT_{name}_bits }};\n')
        names.append(f'{name}: {size}px cell {h}')
    open(os.path.join(OUT, 'neddy_font.h'), 'w').write(''.join(fh))
    print('body', full.size, 'half', half.size, 'eyes', len(EYES), 'fonts', names)
    for f in ('neddy_art.h', 'neddy_font.h'):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB source')

if __name__ == '__main__':
    main()
