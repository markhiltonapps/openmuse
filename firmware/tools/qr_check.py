# Reads every .pgm the QR test wrote with OpenCV's QR reader and compares with the .txt next to it.
import sys, glob, cv2
d = sys.argv[1] if len(sys.argv) > 1 else "/tmp/qr"
bad = 0; n = 0
for p in sorted(glob.glob(d + "/*.pgm")):
    img = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    want = open(p[:-4] + ".txt", "rb").read().decode("utf-8", "replace")
    got, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    n += 1
    if got != want:
        # OpenCV's reader can fail on some sizes at this scale; retry once larger before calling it a failure
        big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        got, pts, _ = cv2.QRCodeDetector().detectAndDecode(big)
    if got != want:
        bad += 1; print("NOT READ:", p, repr(want[:50]), "->", repr(got[:50]))
print(n, "codes read,", bad, "wrong")
sys.exit(1 if bad else 0)
