// Tests the watch's QR maker (neddy_qr.h): writes each code as a picture (.pgm) for a real QR reader to decode (see qr_check.py), and checks the sizes.
//   g++ -O2 -std=c++17 -I firmware/neddy_device firmware/tools/qr_test.cpp -o /tmp/qr_test && /tmp/qr_test /tmp/qr && python3 firmware/tools/qr_check.py /tmp/qr
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include "neddy_qr.h"

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "/tmp/qr";
  std::vector<std::string> texts = {
    "A", "hello", "WIFI:T:WPA;S:Neddy-1A2B;P:k7m2q9xd;;", "WIFI:T:nopass;S:Neddy-1A2B;;", "https://api-production-e97a3.up.railway.app/?pair=482913",
    "http://192.168.4.1/", "0123456789", "The quick brown fox jumps over the lazy dog", "Special chars: ;,:\\\" ünï",
  };
  for (int len = 1; len <= 106; len += 5) { std::string s; for (int i = 0; i < len; i++) s += (char)('a' + (i * 7 + len) % 26); texts.push_back(s); }
  std::string max106(106, 'x'); texts.push_back(max106);
  int failures = 0;
  static QrCode q;
  for (size_t t = 0; t < texts.size(); t++) {
    bool ok = qrEncode(q, texts[t].c_str());
    if (!ok) { printf("FAIL: could not encode %zu bytes\n", texts[t].size()); failures++; continue; }
    char name[256]; snprintf(name, sizeof(name), "%s/%03zu.pgm", dir, t);
    FILE *f = fopen(name, "wb");
    if (!f) { printf("can't write %s (make the folder first)\n", name); return 2; }
    const int scale = 8, quiet = 4, side = (q.size + 2 * quiet) * scale;
    fprintf(f, "P5\n%d %d\n255\n", side, side);
    for (int y = 0; y < side; y++) for (int x = 0; x < side; x++) {
      int mx = x / scale - quiet, my = y / scale - quiet;
      bool dark = mx >= 0 && my >= 0 && mx < q.size && my < q.size && qrGet(q, mx, my);
      fputc(dark ? 0 : 255, f);
    }
    fclose(f);
    char txt[256]; snprintf(txt, sizeof(txt), "%s/%03zu.txt", dir, t);
    f = fopen(txt, "wb"); fwrite(texts[t].data(), 1, texts[t].size(), f); fclose(f);
  }
  // Too long is refused, not cut.
  std::string tooLong(107, 'x');
  if (qrEncode(q, tooLong.c_str())) { printf("FAIL: 107 bytes should be refused\n"); failures++; }
  // The version grows with the text: 14 bytes fit in version 1 (21 dots), 15 need version 2 (25).
  qrEncode(q, std::string(14, 'a').c_str()); if (q.size != 21) { printf("FAIL: 14 bytes should be 21 dots, got %d\n", q.size); failures++; }
  qrEncode(q, std::string(15, 'a').c_str()); if (q.size != 25) { printf("FAIL: 15 bytes should be 25 dots, got %d\n", q.size); failures++; }
  printf("%zu codes written, %d failed\n", texts.size(), failures);
  return failures ? 1 : 0;
}
