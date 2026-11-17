# Wear OS watch app (owner wants this eventually; recorded 2026-11-17)

Status: **idea, not started.** The owner saw MetaMuse's Galaxy Watch feature (tap OK on the phone, a message appears on the watch, then read the latest
messages and talk to the app from the wrist) and wants Neddy to do the same later. Keep it in mind when building anything that a watch would also use.

## The owner's hardware and what they showed
- Samsung Galaxy Watch Ultra, model SM-L705U (Wear OS; the "U" is the US carrier model, believed to have LTE, so a standalone app can reach our server by itself; verify).
- Phone: a Samsung Galaxy Fold (Android).
- MetaMuse's watch UI (two photos): a full-screen avatar home; a scrolling latest-message card with "Continue on phone >" under it; a bottom row with a keyboard
  button, the small avatar, and a microphone button. Standard Wear OS Compose look. Approvals reach the wrist as cards with Allow/Deny.

## Answer to "do we need a phone app first?"
No. A native phone app is only needed for the one-tap "connect your watch" prompt and for a relay when the watch has no connection of its own.
A standalone Wear OS app can pair with a six-digit code (the same flow the ESP32 watch already uses) and talk to our server over the watch's own Wi-Fi/LTE.
The phone side can stay the web app for now. (This is the plan; an experiment with the phone left at home confirms the watch works on its own.)

## Shape (from general Wear OS knowledge and the explainer the owner shared; Meta's internals are not public)
- The watch never runs the model; it sends text and shows results. Our server already works this way for the ESP32 watch.
- Background limits: no permanent socket on a watch. The watch sends over plain HTTPS when the person acts; Google's push (FCM, needs a Firebase project the owner creates)
  wakes it when the server has something (a reply, an approval).
- The watch gets its own narrow, revocable device token (we already issue one when a device pairs). Device registry per person with a platform and what each device can do.
- Approvals on the wrist: the same Approve cards the chat and calls use, one tap Allow/Deny, one action each. Build this into the first version; it is what makes it trustworthy.
- Dictation uses Wear OS's own voice input (text in, text out), not raw audio streaming. Tile and watch-face complication later.

## First version, in order
1. Server routes for a paired watch (device token): latest messages, send a message, list and decide an approval. Testable here. (Not built.)
2. Wear OS app (Kotlin, Compose for Wear OS): avatar home, scrolling message card, keyboard + mic, approval card. Needs the owner's Android Studio; the sandbox cannot build it.
3. FCM push so replies and approvals arrive when the app is closed.
4. Tile and complication; direct LTE check; a phone app later if one-tap pairing is wanted.

## Keep in mind when building now (so this stays cheap later)
- Any new feature that makes a card, an approval or a notification should reach a *device* through one path (the device bridge / a notify function), not only the web app, so a watch can receive it later.
- Everything a tap does must also be sayable (owner rule); a watch has a tiny screen, so every card needs a short plain-text form (the ESP32 `deviceCard` is the model).
- Tool results never claim "it's on your screen" for a device that cannot draw it (`DEVICE_SCREEN`); a Wear OS device will have its own list.
- Device tokens stay scoped to the device's own routes. Never give a watch the account session.
- Log each device command server-side (device, command, approval id) so "what did Neddy do on my watch?" can be answered.

## Open questions for the owner (not yet answered)
- Does the Ultra have LTE active, and should the app work with the phone out of range?
- Android Studio on a computer, and developer mode + wireless debugging on the watch (needed before any watch code can be tested).
- Google Play listing only if other people should install it; for the owner alone a direct install is enough.
