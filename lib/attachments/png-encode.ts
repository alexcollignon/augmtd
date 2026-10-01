// A minimal PNG encoder (pure, server-side — node zlib only, no native module). Used to hand a
// scanned PDF page's decoded image (pdfjs gives raw pixels for EVERY image filter it understands —
// DCT, Flate, CCITT, JBIG2, JPX) to the OCR slot, which takes PNG/JPEG only.
import { deflateSync } from 'zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** pdfjs ImageKind: 1 = GRAYSCALE_1BPP (bit set = white), 2 = RGB_24BPP, 3 = RGBA_32BPP. */
export type RawImage = { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray };

/** Encode raw pixels as an 8-bit PNG (gray for 1-bpp, RGB for 24-bpp, RGBA for 32-bpp). Returns
 *  null for a layout it does not know (the caller skips that image — never guesses). */
export function encodePng(img: RawImage): Buffer | null {
  const { width: w, height: h, kind, data } = img;
  if (!w || !h) return null;
  const channels = kind === 1 ? 1 : kind === 2 ? 3 : kind === 3 ? 4 : 0;
  if (!channels) return null;
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  if (kind === 1) {
    const rowBytes = (w + 7) >> 3;
    if (data.length < rowBytes * h) return null;
    for (let y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        raw[y * (stride + 1) + 1 + x] = bit ? 255 : 0;
      }
    }
  } else {
    if (data.length < stride * h) return null;
    for (let y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0; // filter: none
      Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
