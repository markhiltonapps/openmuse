#!/usr/bin/env python3
"""
The Help guide's picture of the watch's own screens (topic "watch-screens"), made from the firmware's real drawing code.

  1. Build and run the screen test for the round screen (it draws exactly what the watch draws):
       g++ -O2 -std=c++17 -DNEDDY_ROUND=1 -I firmware/neddy_device firmware/tools/ui_sim.cpp -o /tmp/ui_sim && /tmp/ui_sim /tmp/frames
  2. Then, from the repo root (needs Pillow):
       python3 firmware/tools/watch_help_shot.py /tmp/frames
  It writes apps/mobile/public/help/shots/watch-screens-{light,dark}.webp (720 px wide) with the numbered marks the steps
  point at: 1 the launcher, 2 Record, 3 Settings, 4 Info. Check apps/mobile/src/help-shots.ts has its size (printed below).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'mobile', 'public', 'help', 'shots')
FRAMES = sys.argv[1] if len(sys.argv) > 1 else '/tmp/frames'
SCREENS = ['m1_launcher', 'n2_record_2', 'p0_setting', 'q0_info']   # the numbers 1..4, left to right, top to bottom
BLUE = (20, 115, 200)                                               # the marks' blue (scripts/help-shots.mjs)
W, CELL, GAP, PAD = 720, 330, 20, 20

def font(size):
    for f in ('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

def make(dark):
    bg = (18, 24, 32) if dark else (238, 240, 243)
    case = (150, 156, 162) if dark else (178, 182, 188)
    rows = (len(SCREENS) + 1) // 2
    H = PAD * 2 + rows * CELL + (rows - 1) * GAP
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    for i, name in enumerate(SCREENS):
        shot = Image.open(os.path.join(FRAMES, name + '.ppm')).convert('RGB').resize((CELL - 16, CELL - 16), Image.LANCZOS)
        col, row = i % 2, i // 2
        x = PAD + col * (CELL + GAP) + (W - 2 * PAD - 2 * CELL - GAP) // 2
        y = PAD + row * (CELL + GAP)
        d.ellipse((x, y, x + CELL - 1, y + CELL - 1), fill=case)            # the watch's metal rim
        mask = Image.new('L', shot.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, shot.width - 1, shot.height - 1), fill=255)
        img.paste(shot, (x + 8, y + 8), mask)
        cx, cy, r = x + 30, y + 30, 22                                       # the number, on the rim at the top left
        d.ellipse((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), fill=(255, 255, 255))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=BLUE)
        f = font(26)
        t = str(i + 1)
        tw, th = d.textbbox((0, 0), t, font=f)[2:]
        d.text((cx - tw / 2, cy - th / 2 - 3), t, font=f, fill=(255, 255, 255))
    return img

for dark in (False, True):
    img = make(dark)
    path = os.path.join(OUT, 'watch-screens-%s.webp' % ('dark' if dark else 'light'))
    img.save(path, 'WEBP', quality=88)
    print(path, img.size)
