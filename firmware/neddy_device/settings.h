// ===========================================================================
//  The only file you need to edit. Change the two lines marked  <<< EDIT
//  (keep the quotation marks "like this"), then press Upload.
// ===========================================================================
#pragma once

// <<< EDIT: the name of your Wi-Fi network, exactly as it appears on your phone.
#define WIFI_NAME "your Wi-Fi name"

// <<< EDIT: your Wi-Fi password (the board needs a normal home Wi-Fi: 2.4 GHz, no sign-in page).
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
