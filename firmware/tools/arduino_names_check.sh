#!/bin/sh
# Compiles every PC test with the Arduino core's macros forced in, so a name the
# core already uses (PI, HIGH, constrain, ...) breaks here, not in the owner's
# Arduino IDE. Run from firmware/: sh tools/arduino_names_check.sh
cd "$(dirname "$0")/.." || exit 1
fail=0
for f in tools/*.cpp; do
  if g++ -std=c++17 -fsyntax-only -include tools/arduino_macros.h -Ineddy_device "$f" 2>/tmp/arduino_names.err; then
    echo "ok   $f"
  else
    echo "FAIL $f"; head -8 /tmp/arduino_names.err; fail=1
  fi
done
exit $fail
