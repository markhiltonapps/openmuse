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

## Watches WITHOUT LTE must work too (owner, 2026-11-17: "MetaMuse doesn't need LTE")
- Wear OS lends the paired phone's connection to the watch over Bluetooth ("proxied" network), so ordinary small HTTPS requests from a standalone watch app work on a Wi-Fi-only watch whenever the phone is near.
  It is slow and low-bandwidth, so: text only, small payloads, no streaming audio, no held-open socket, retry with a short backoff, queue a message when there is no connection and send it later, and
  say "no connection" on screen. (General Wear OS behaviour; to be verified on the owner's watch.)
- Out of range of the phone and with no Wi-Fi, a non-LTE watch cannot reach us at all. The Data Layer relay through a native phone app only helps when the phone is online, so it adds reliability, not range.
  A native phone companion stays optional (one-tap pairing, steadier delivery); it is not required for the first version.
- Push (FCM) to a non-LTE watch is believed to arrive through the same phone link: verify it before promising instant delivery.
- Owner confirmed (2026-11-17): MetaMuse's watch app works over Bluetooth only, with no Wi-Fi. That fits either the phone-lent connection above or a relay through its phone app; which one it is is not known.
  Our design assumes the phone-lent connection (no phone app) and should be checked on the owner's watch first; if it fails, a native phone app with the Wearable Data Layer becomes required, not optional.
- Test to run on the owner's watch (partly done by the owner for MetaMuse): turn off the watch's Wi-Fi and cellular (keep Bluetooth), send a message from MetaMuse's watch app, and see whether it works.

## Other watches, including Apple Watch (owner, 2026-11-17: "I need this to also work on other watches, including Apple")
- Each watch platform is its own native app and its own project: Wear OS (Kotlin + Compose for Wear OS; covers Galaxy Watch 4+, Pixel Watch, OnePlus, Fossil and others) and Apple Watch (Swift + SwiftUI, watchOS).
  Nothing shares UI code between them. Garmin (Monkey C) and others are possible later and would also be separate.
- What CAN be shared is the server: one platform-neutral "watch API" (paired device token, latest messages, send a message, list and decide an approval, plain-text cards) used by every watch app and by the ESP32 watch.
  Build and test that first, with nothing in it that is specific to Wear OS (no Google-only fields); push providers sit behind one function (FCM for Wear OS, APNs for Apple Watch).
- Apple Watch needs: a Mac with Xcode, an Apple Developer account (paid yearly), and TestFlight or the App Store for anyone but the owner. A non-cellular Apple Watch reaches the internet through its iPhone (or Wi-Fi); a
  watch-only app is allowed, but it is still installed via the iPhone's Watch app. Ask the owner whether they have a Mac and an Apple Developer account before promising a date.
- Works on every watch with NO watch app: web push to the phone (already built) mirrors to a paired Apple Watch or Wear OS watch as a notification (Apple: the web app must be added to the iPhone Home Screen, iOS 16.4+).
  It is read-only or quick-reply at best, but it is the fallback that covers all brands today.
- DECISION (owner, 2026-11-18): no Apple Developer account, so the target is **Wear OS on Android only** for now. The Apple Watch app waits until the owner has an account and a Mac.
  The server API still stays platform-neutral so Apple Watch can be added later without reworking it.
- Order proposed: (1) platform-neutral watch API, (2) Wear OS app, (3) Apple Watch app, (4) others on demand. Keep text-only, small payloads, queued sends and "no connection" states on all of them.

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
