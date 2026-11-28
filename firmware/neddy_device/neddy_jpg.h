/* Vendored for Neddy's watch from ChaN's TJpgDec R0.03 (http://elm-chan.org/fsw/tjpgd/). Names prefixed (njd_, NJD_) so they can't
   meet the copy in the ESP32's ROM headers; settings in neddy_jpg_cnf.h. Otherwise unchanged. */
/*----------------------------------------------------------------------------/
/ TJpgDec - Tiny JPEG Decompressor R0.03 include file         (C)ChaN, 2021
/----------------------------------------------------------------------------*/
#ifndef DEF_TJPGDEC
#define DEF_TJPGDEC

#ifdef __cplusplus
extern "C" {
#endif

#include "neddy_jpg_cnf.h"
#include <string.h>

#if defined(_WIN32)	/* VC++ or some compiler without stdint.h */
typedef unsigned char	uint8_t;
typedef unsigned short	uint16_t;
typedef short			int16_t;
typedef unsigned long	uint32_t;
typedef long			int32_t;
#else				/* Embedded platform */
#include <stdint.h>
#endif

#if NJD_FASTDECODE >= 1
typedef int16_t njd_yuv_t;
#else
typedef uint8_t njd_yuv_t;
#endif


/* Error code */
typedef enum {
	NJDR_OK = 0,	/* 0: Succeeded */
	NJDR_INTR,	/* 1: Interrupted by output function */	
	NJDR_INP,	/* 2: Device error or wrong termination of input stream */
	NJDR_MEM1,	/* 3: Insufficient memory pool for the image */
	NJDR_MEM2,	/* 4: Insufficient stream input buffer */
	NJDR_PAR,	/* 5: Parameter error */
	NJDR_FMT1,	/* 6: Data format error (may be broken data) */
	NJDR_FMT2,	/* 7: Right format but not supported */
	NJDR_FMT3	/* 8: Not supported JPEG standard */
} NJRESULT;



/* Rectangular region in the output image */
typedef struct {
	uint16_t left;		/* Left end */
	uint16_t right;		/* Right end */
	uint16_t top;		/* Top end */
	uint16_t bottom;	/* Bottom end */
} NJRECT;



/* Decompressor object structure */
typedef struct NJDEC NJDEC;
struct NJDEC {
	size_t dctr;				/* Number of bytes available in the input buffer */
	uint8_t* dptr;				/* Current data read ptr */
	uint8_t* inbuf;				/* Bit stream input buffer */
	uint8_t dbit;				/* Number of bits availavble in wreg or reading bit mask */
	uint8_t scale;				/* Output scaling ratio */
	uint8_t msx, msy;			/* MCU size in unit of block (width, height) */
	uint8_t qtid[3];			/* Quantization table ID of each component, Y, Cb, Cr */
	uint8_t ncomp;				/* Number of color components 1:grayscale, 3:color */
	int16_t dcv[3];				/* Previous DC element of each component */
	uint16_t nrst;				/* Restart inverval */
	uint16_t width, height;		/* Size of the input image (pixel) */
	uint8_t* huffbits[2][2];	/* Huffman bit distribution tables [id][dcac] */
	uint16_t* huffcode[2][2];	/* Huffman code word tables [id][dcac] */
	uint8_t* huffdata[2][2];	/* Huffman decoded data tables [id][dcac] */
	int32_t* qttbl[4];			/* Dequantizer tables [id] */
#if NJD_FASTDECODE >= 1
	uint32_t wreg;				/* Working shift register */
	uint8_t marker;				/* Detected marker (0:None) */
#if NJD_FASTDECODE == 2
	uint8_t longofs[2][2];		/* Table offset of long code [id][dcac] */
	uint16_t* hufflut_ac[2];	/* Fast huffman decode tables for AC short code [id] */
	uint8_t* hufflut_dc[2];		/* Fast huffman decode tables for DC short code [id] */
#endif
#endif
	void* workbuf;				/* Working buffer for IDCT and RGB output */
	njd_yuv_t* mcubuf;			/* Working buffer for the MCU */
	void* pool;					/* Pointer to available memory pool */
	size_t sz_pool;				/* Size of momory pool (bytes available) */
	size_t (*infunc)(NJDEC*, uint8_t*, size_t);	/* Pointer to jpeg stream input function */
	void* device;				/* Pointer to I/O device identifiler for the session */
};



/* TJpgDec API functions */
NJRESULT njd_prepare (NJDEC* jd, size_t (*infunc)(NJDEC*,uint8_t*,size_t), void* pool, size_t sz_pool, void* dev);
NJRESULT njd_decomp (NJDEC* jd, int (*outfunc)(NJDEC*,void*,NJRECT*), uint8_t scale);


#ifdef __cplusplus
}
#endif

#endif /* _NEDDY_JPG */
