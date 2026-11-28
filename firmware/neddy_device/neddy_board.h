// neddy_board.h: which watch board this build is for, and its pins. Pick the board in settings.h:
//   #define NEDDY_BOARD 206   Waveshare ESP32-S3-Touch-AMOLED-2.06   (a rectangle with rounded corners, 410 x 502)
//   #define NEDDY_BOARD 175   Waveshare ESP32-S3-Touch-AMOLED-1.75C  (round, 466 x 466, aluminium case)
//
// The 1.75C facts come from Waveshare's own sources (2026-11-27): the board_config pin_config.h and examples in
// github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C, its schematic, and Waveshare's ESP-IDF board package
// (esp32_s3_touch_amoled_1_75c 3.0.0). It has the same display chip (CO5300), power chip (AXP2101), motion chip (QMI8658),
// speaker chip (ES8311) and microphone chip (ES7210) as the 2.06; what differs is the touch chip (CST9217 at 0x5A, not FT3168),
// the display's column offset (6), and pins: GPIO10 is the microphone line there, so the PWR button is read on GPIO3.
// Not yet checked on a real 1.75C when written: the PWR level on GPIO3 (read from the schematic: high while pressed) and the
// motion chip's axes (raise-to-wake). The screen's test line shows both.
#pragma once

// What the buttons are called on screen. The round watch's case has no labels: the small button is BOOT (talk) and the big one is PWR
// (the menu) (owner, 2026-11-28), so it says "small button" / "big button". The 2.06 keeps the board's names.

#ifndef NEDDY_BOARD
// An old settings.h without the board line used to build for the 2.06 without a word, which on the round watch is a
// black screen (it happened twice, 2026-11-27 and 11-28). Now the build stops and says what to add.
#error "settings.h doesn't say which watch this is. Add this line near the top of settings.h: #define NEDDY_BOARD 175 (the round 1.75C) or #define NEDDY_BOARD 206 (the rectangular 2.06)."
#endif

#if NEDDY_BOARD == 175
#define NEDDY_ROUND 1
#define BTN_TALK "small button"
#define BTN_TALK_CAP "Small button"
#define BTN_MENU "big button"
#define BTN_MENU_CAP "Big button"
#define BTN_TALK_ANGLE 130         // where the buttons are on the case, degrees clockwise from 12 with the watch upright
#define BTN_MENU_ANGLE 50          // (small at about 4 o'clock, big at about 1:30), measured from the owner's photo (2026-11-28); the screen's marks point at these
#define BOARD_LABEL "1.75C round"
#define BOARD_W 466
#define BOARD_H 466
#define LCD_COL_OFFSET 6
#define PIN_LCD_CS 12
#define PIN_LCD_SCLK 38
#define PIN_LCD_D0 4
#define PIN_LCD_D1 5
#define PIN_LCD_D2 6
#define PIN_LCD_D3 7
#define PIN_LCD_RESET 1
#define PIN_I2C_SDA 15
#define PIN_I2C_SCL 14
#define PIN_TP_RESET 2
#define PIN_TP_INT 11
#define TOUCH_CST9217 1               // CST9217 at 0x5A: read 15 bytes after the 16-bit command D0 00, then acknowledge with D0 00 AB
#define TP_I2C_ADDR 0x5A
#define TOUCH_MIRROR 1                // Waveshare's example mirrors both x and y on this board
#define PIN_PWR_KEY 3                 // high while PWR is pressed (through a transistor from the power chip's PWRON line)
#define PIN_I2S_BCLK 9
#define PIN_I2S_WS 45
#define PIN_I2S_DOUT 8
#define PIN_I2S_DIN 10
#define PIN_I2S_MCLK 16
#define PIN_SPEAKER_AMP 46
#else
#define NEDDY_ROUND 0
#define BTN_TALK "BOOT button"
#define BTN_TALK_CAP "BOOT"
#define BTN_MENU "PWR button"
#define BTN_MENU_CAP "PWR"
#define BOARD_LABEL "2.06"
#define BOARD_W 410
#define BOARD_H 502
#define LCD_COL_OFFSET 22
// The 2.06's screen and I2C pins come from Waveshare's own pin_config.h (installed with its libraries), as before.
#define PIN_LCD_CS LCD_CS
#define PIN_LCD_SCLK LCD_SCLK
#define PIN_LCD_D0 LCD_SDIO0
#define PIN_LCD_D1 LCD_SDIO1
#define PIN_LCD_D2 LCD_SDIO2
#define PIN_LCD_D3 LCD_SDIO3
#define PIN_LCD_RESET LCD_RESET
#define PIN_I2C_SDA IIC_SDA
#define PIN_I2C_SCL IIC_SCL
#define PIN_TP_RESET 9
#define TOUCH_CST9217 0               // FT3168 at 0x38: registers 0x02..0x06
#define TP_I2C_ADDR 0x38
#define TOUCH_MIRROR 0
#define PIN_PWR_KEY 10                // high while PWR is pressed
#define PIN_I2S_BCLK 41
#define PIN_I2S_WS 45
#define PIN_I2S_DOUT 40
#define PIN_I2S_DIN 42
#define PIN_I2S_MCLK 16
#define PIN_SPEAKER_AMP 46
#endif
