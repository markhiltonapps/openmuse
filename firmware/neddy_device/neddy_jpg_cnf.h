/* Vendored for Neddy's watch from ChaN's TJpgDec R0.03 (http://elm-chan.org/fsw/tjpgd/). Names prefixed (njd_, NJD_) so they can't
   meet the copy in the ESP32's ROM headers; settings in neddy_jpg_cnf.h. Otherwise unchanged. */
/*----------------------------------------------*/
/* TJpgDec System Configurations R0.03          */
/*----------------------------------------------*/

#define	NJD_SZBUF		1024
/* Specifies size of stream input buffer */

#define NJD_FORMAT		1
/* Specifies output pixel format.
/  0: RGB888 (24-bit/pix)
/  1: RGB565 (16-bit/pix)
/  2: Grayscale (8-bit/pix)
*/

#define	NJD_USE_SCALE	0
/* Switches output descaling feature.
/  0: Disable
/  1: Enable
*/

#define NJD_TBLCLIP		1
/* Use table conversion for saturation arithmetic. A bit faster, but increases 1 KB of code size.
/  0: Disable
/  1: Enable
*/

#define NJD_FASTDECODE	2
/* Optimization level
/  0: Basic optimization. Suitable for 8/16-bit MCUs.
/  1: + 32-bit barrel shifter. Suitable for 32-bit MCUs.
/  2: + Table conversion for huffman decoding (wants 6 << HUFF_BIT bytes of RAM)
*/

