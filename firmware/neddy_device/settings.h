// ===========================================================================
//  Settings for the person building the watch.
//  Wi-Fi: a new watch (with the two lines below left as they are) shows a QR code on its screen and you pick your
//  Wi-Fi from your phone. While building, you can instead type your Wi-Fi in the two lines below: the watch then
//  uses it directly and never shows the QR code. (Plug the watch in while holding BOOT, and keep holding, to forget a saved Wi-Fi.)
//  To test the QR setup on a watch whose Wi-Fi is typed below, add this line at the top of this file:
//      #define NEDDY_FORCE_QR_SETUP 1
// ===========================================================================
#pragma once

// Which board this is (the pins and the screen's shape follow from it, see neddy_board.h):
//   206 = Waveshare ESP32-S3-Touch-AMOLED-2.06 (rectangle)     175 = Waveshare ESP32-S3-Touch-AMOLED-1.75C (round, aluminium case)
// For the 1.75C also install Waveshare's libraries for that board (Arduino_GFX, its board files) as its guide says.
#ifndef NEDDY_BOARD
#define NEDDY_BOARD 206
#endif

#define WIFI_NAME "your Wi-Fi name"
#define WIFI_PASSWORD "your Wi-Fi password"

// Where Neddy lives. Leave this alone unless you were told to change it.
#define NEDDY_SERVER "api-production-e97a3.up.railway.app"

// What the board calls itself in your list of devices.
#define DEVICE_MODEL "Waveshare watch board"

// The software version the board reports.
#define FIRMWARE_VERSION "0.2.0"

// How loud the speaker is (0 to 100).
#define SPEAKER_VOLUME 85

// How sensitive the microphone is (0 quietest to 7 most sensitive). Waveshare's own test uses 3.
#define MIC_GAIN 3

// The most seconds one press of the button can talk (a stuck button can't run on forever).
#define MAX_TALK_SECONDS 30
