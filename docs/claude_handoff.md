# Hand-off for the next Claude session (2026-11-28)

Paste this as the first message of a new session on **markhiltonapps/openmuse**, branch
`claude/deploy-openmuse-repo-oza7s9`, or tell the new session: "Read docs/claude_handoff.md and carry on."

## Read first, in this order
1. `CLAUDE.md`: the rules and the lessons learned. The watch lessons are at the end.
2. `docs/claude_working_session_20261127.txt`: the latest notes. The 2026-11-28 work is at the end of that file.
3. The owner's own notes (`docs/working_session_*.txt`), newest first, if any are newer than this file.

## Where things stand
- Everything is committed and pushed. The last commit is `ec0fb46`, "Watch: Neddy's animated scenes on the recording screen
  and weather card". Nothing is waiting locally.
- The work right now is firmware for the round **Waveshare ESP32-S3-Touch-AMOLED-1.75C** watch (`firmware/neddy_device`).
- The owner's build stopped because his `settings.h` was an old copy without `#define NEDDY_BOARD 175`. He was given the full
  file to paste. The values are below. **Next step: wait for his build result.** That means either error lines or a photo of
  the watch.

### The owner's settings.h (round watch)
```cpp
#pragma once
// Which board: 206 = 2.06 rectangle, 175 = 1.75C round
#ifndef NEDDY_BOARD
#define NEDDY_BOARD 175
#endif
#define WIFI_NAME "your Wi-Fi name"
#define WIFI_PASSWORD "your Wi-Fi password"
#define NEDDY_SERVER "api-production-e97a3.up.railway.app"
#define DEVICE_MODEL "Waveshare watch board"
#define FIRMWARE_VERSION "0.2.0"
#define SPEAKER_VOLUME 85
#define MIC_GAIN 3
#define MAX_TALK_SECONDS 30
```
- He keeps his real Wi-Fi details himself. Never ask for the password or write it anywhere.
- If the watch already joined Wi-Fi through the QR or Bluetooth setup, the placeholder lines can stay as they are.
- `settings.h` is left out of `docs/neddy_device.zip` on purpose. Tell him to keep a copy outside the sketch folder.

## What to check on his first photo or video
These have never run on the real chip. The Arduino core can't be downloaded in the sandbox, so his build is the first real
compile.
- **Scenes:** Neddy's animations should play on the recording screen (notepad, bulb, microphone, nightcap) and on the weather
  card (umbrella, woolly hat, fan, sunglasses). Check whether they are smooth: decoding a frame is expected to take 10-20 ms on
  the chip, but this hasn't been measured.
- **Rotation:** the picture should flip only between upright and upside down. The chip's axes were swapped based on a photo, so
  this is unconfirmed.
- **Button labels:** MENU and TALK sit on the rim at about 50° and 130°. Check that they point at the real buttons.
- **Readout lines:** they sit at y 404 on the round screen. Check that they aren't cut off by the circle.
- **Build errors** usually come from the Arduino core's names (`PI`, `HIGH`, ...) or from call shapes that differ by core
  version. Run `sh firmware/tools/arduino_names_check.sh` before handing over any firmware.

## Open items
- **These need the owner's yes before anyone builds them:**
  - Server wording "Chance of" for sky forecasts.
  - "Room for 1 h 18 min" instead of "1 h 18 min left".
  - Watch conversations in the app.
- **Next art pass:**
  - The sunglasses visor reads too dark at this size.
  - The Idea clip draws Neddy smaller than the other clips.
- **Reviewer nits saved for later:**
  - Show TALK for a few seconds after a wake and on cards.
  - A one-time "auto-rotate" note.
  - A wider "near a mark" margin for launcher icons at 180° and 270°.
  - Move "Hold to stop" a few px in at 90° and 270°.
  - A bigger recording time.
- **Not built:**
  - A clock face that uses Neddy's arms as hands.
  - The Wear OS app (planned in `docs/WEAR-OS-WATCH-PLAN.md`).

## Testing on the PC
Each test in `firmware/tools/*.cpp` has its build command in the first lines of the file, for example:
`g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/touch_test.cpp -o /tmp/touch_test && /tmp/touch_test`

| Test | Last result |
|---|---|
| `frame_test` | 40/40 |
| `touch_test` (build both boards) | 159/159 |
| `scene_test` | 33/33 |
| `ui_sim` (`-DNEDDY_ROUND=1` for the round watch, `-DSIM_SCENES` for the scenes) | 0 odd windows, 0 under a mark |
| `rec_test` | 19/19 |
| `raise_test` | 18/18 |
| `audio_test` | 17/17 |
| `arduino_names_check.sh` | 10/10 |

## Rules that bite
- **Pushes:** commit locally and push only when the owner says "push it". A push to this branch deploys to Railway at once.
  Right before pushing, check the api's logs for a live call.
- **The big button:** on the round watch the small button (BOOT, at about 4 o'clock) is hold to talk and double-click for the
  menu. The big button (PWR, at about 1 o'clock) opens the menu. Holding the big button for about 6 s switches the watch off,
  so never tell anyone to hold it long.
- **What goes with every visible change:**
  - Help (`packages/domain/src/help.ts` and its pictures) in the same commit.
  - The website when people would notice the change.
  - The Design reviewers (visual, usability and copy) for new UI.
  - Session notes in `docs/claude_working_session_YYYYMMDD.txt`.
  - Lessons in `CLAUDE.md`.
  - No time log.
- **Asking:** when something is unclear, ask the owner instead of guessing.
