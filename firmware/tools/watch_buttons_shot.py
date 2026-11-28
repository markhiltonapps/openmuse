#!/usr/bin/env python3
"""
The Help guide's labelled picture of the round watch's buttons (topic "watch-buttons"): the case drawn clean, with the
watch's real home screen inside it (from the firmware's own drawing code, so the TALK and MENU marks on the rim are the
real ones), and numbers on the big button (1, about 1 o'clock), the small button (2, about 4 o'clock) and the USB port
(3, at the bottom). Drawn from the owner's labelled photo of his watch (2026-11-28), cleaned up.

  1. Build and run the screen test for the round screen:
       g++ -O2 -std=c++17 -DNEDDY_ROUND=1 -I firmware/neddy_device firmware/tools/ui_sim.cpp -o /tmp/ui_sim && /tmp/ui_sim /tmp/frames
  2. From the repo root (needs Pillow):
       python3 firmware/tools/watch_buttons_shot.py /tmp/frames
  It writes apps/mobile/public/help/shots/watch-buttons-{light,dark}.webp; check apps/mobile/src/help-shots.ts has its size.
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'mobile', 'public', 'help', 'shots')
FRAMES = sys.argv[1] if len(sys.argv) > 1 else '/tmp/frames'
BLUE = (20, 115, 200)                       # the numbers' blue (scripts/help-shots.mjs)
S = 2                                       # drawn at twice the size, then scaled down (smooth edges)
W, H = 720, 600
CX, CY, R_CASE, R_SCREEN = 300, 300, 232, 196
BIG, SMALL, USB = 30, 120, 180              # degrees clockwise from 12

def font(size, bold=True):
    names = ('Inter-SemiBold.otf',) if bold else ('Inter-Regular.otf',)
    for n in names:
        f = '/usr/share/fonts/opentype/inter/' + n
        if os.path.exists(f):
            return ImageFont.truetype(f, size * S)
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size * S)

def at(angle, r):
    t = math.radians(angle)
    return (CX + r * math.sin(t)) * S, (CY - r * math.cos(t)) * S

def button(d, angle, length, out, colour, edge):
    """A button on the case's edge: a rounded bar standing out from the rim."""
    t = math.radians(angle)
    half = math.degrees(length / 2 / R_CASE)
    pts = []
    for a in (angle - half, angle + half):
        pts.append(at(a, R_CASE - 4))
    for a in (angle + half, angle - half):
        pts.append(at(a, R_CASE + out))
    d.polygon(pts, fill=colour, outline=edge, width=2 * S)

def number(d, x, y, n):
    r = 17 * S
    d.ellipse((x - r - 3 * S, y - r - 3 * S, x + r + 3 * S, y + r + 3 * S), fill=(255, 255, 255))
    d.ellipse((x - r, y - r, x + r, y + r), fill=BLUE)
    f = font(20)
    tw, th = d.textbbox((0, 0), str(n), font=f)[2:]
    d.text((x - tw / 2, y - th / 2 - 3 * S), str(n), font=f, fill=(255, 255, 255))

def make(dark):
    bg = (18, 24, 32) if dark else (238, 240, 243)
    ink = (232, 236, 240) if dark else (28, 34, 42)
    soft = (150, 160, 170) if dark else (96, 104, 114)
    line = (110, 120, 130) if dark else (150, 158, 166)
    img = Image.new('RGB', (W * S, H * S), bg)
    d = ImageDraw.Draw(img)
    # the buttons first, so the case's rim sits over their roots
    metal, metal_edge = ((168, 174, 180), (120, 126, 132)) if dark else ((196, 200, 205), (140, 146, 152))
    button(d, BIG, 58, 13, metal, metal_edge)
    button(d, SMALL, 38, 10, metal, metal_edge)
    # the case: a brushed-metal ring with a dark glass inside
    d.ellipse(((CX - R_CASE) * S, (CY - R_CASE) * S, (CX + R_CASE) * S, (CY + R_CASE) * S), fill=metal, outline=metal_edge, width=2 * S)
    d.ellipse(((CX - R_CASE + 12) * S, (CY - R_CASE + 12) * S, (CX + R_CASE - 12) * S, (CY + R_CASE - 12) * S), fill=(12, 12, 14))
    # the USB port: a small dark slot in the rim at the bottom
    ux, uy = at(USB, R_CASE - 5)
    d.rounded_rectangle((ux - 22 * S, uy - 5 * S, ux + 22 * S, uy + 5 * S), radius=5 * S, fill=(40, 42, 46), outline=metal_edge, width=S)
    # the real screen
    shot = Image.open(os.path.join(FRAMES, 's1_ready_still.ppm')).convert('RGB').resize((2 * R_SCREEN * S, 2 * R_SCREEN * S), Image.LANCZOS)
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, shot.width - 1, shot.height - 1), fill=255)
    img.paste(shot, ((CX - R_SCREEN) * S, (CY - R_SCREEN) * S), mask)
    # callouts: a thin line from each part to its number and words on the right (USB below)
    label = font(22)
    sub = font(16, bold=False)
    callouts = [
        (BIG, 1, 'Big button', 'menu, back, stop', (520, 96)),
        (SMALL, 2, 'Small button', 'hold to talk', (520, 478)),
        (USB, 3, 'USB port', 'charging, new software', (520, 556)),
    ]
    for angle, n, title, what, (lx, ly) in callouts:
        sx, sy = at(angle, R_CASE + (14 if angle == BIG else 11 if angle == SMALL else 4))   # from the button's tip
        nx, ny = (lx - 30) * S, ly * S
        if angle == USB:
            d.line((sx, sy, sx, ny, nx - 22 * S, ny), fill=line, width=2 * S, joint='curve')
        else:
            d.line((sx, sy, nx - 22 * S, ny), fill=line, width=2 * S)
        number(d, nx, ny, n)
        d.text((lx * S, (ly - 17) * S), title, font=label, fill=ink)
        d.text((lx * S, (ly + 9) * S), what, font=sub, fill=soft)
    return img.resize((W, H), Image.LANCZOS)

for dark in (False, True):
    img = make(dark)
    path = os.path.join(OUT, 'watch-buttons-%s.webp' % ('dark' if dark else 'light'))
    img.save(path, 'WEBP', quality=88)
    print(path, img.size)
