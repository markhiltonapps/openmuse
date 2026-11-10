// ===========================================================================
//  Settings for the person building the watch. The Wi-Fi is NOT set here any more:
//  a new watch shows a QR code on its screen; scan it with your phone and pick your Wi-Fi.
//  (To forget the Wi-Fi later: plug the watch in while holding BOOT, and keep holding.)
// ===========================================================================
#pragma once

// Only used if you add the line   #define NEDDY_USE_SETTINGS_WIFI 1   at the top of this file (handy while building: the watch
// then uses these two when it has no Wi-Fi saved).
#define WIFI_NAME "your Wi-Fi name"
#define WIFI_PASSWORD "your Wi-Fi password"

// Where Neddy lives. Leave this alone unless you were told to change it.
#define NEDDY_SERVER "api-production-e97a3.up.railway.app"

// What the board calls itself in your list of devices.
#define DEVICE_MODEL "Waveshare watch board"

// The software version the board reports.
#define FIRMWARE_VERSION "0.1.0"

// How loud the speaker is (0 to 100).
#define SPEAKER_VOLUME 85

// How sensitive the microphone is (0 quietest to 7 most sensitive). Waveshare's own test uses 3.
#define MIC_GAIN 3

// The most seconds one press of the button can talk (a stuck button can't run on forever).
#define MAX_TALK_SECONDS 30
