/* ═══════════════════════════════════════════════════════════════════════════
   A minimal PNG ENCODER, for tests that need to control what is behind the text.

   The repo already carries a hand-rolled PNG *decoder* on node's zlib (the
   per-token legibility sweep, 2026-07-17) for the same reason this exists: no
   image library is a dependency here and none should become one for a test.

   Why synthesise the photograph at all. V3's legibility is measured per photo —
   core/scrim.js samples the ground and solves for the smallest opacity that
   clears its target — so a contrast sweep that lets the real Immich library pick
   the backdrop is measuring whichever photograph happened to be up. That is a
   different number on every run and on every machine. A ground written here is
   the same worst case every time, which is the only way the result is a gate
   rather than an anecdote.

   8-bit truecolour, filter 0 on every row. Nothing here needs interlacing,
   palettes or alpha, and each of those is a chance to be subtly wrong.
   ═══════════════════════════════════════════════════════════════════════════ */

import zlib from "zlib";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {number} w
 * @param {number} h
 * @param {(x:number, y:number) => [number,number,number]} px  0..255 per channel
 * @returns {Buffer} a complete PNG
 */
export function encodePng(w, h, px) {
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    let o = y * stride;
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw[o++] = r & 0xff;
      raw[o++] = g & 0xff;
      raw[o++] = b & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  // 10..12: compression, filter, interlace — all 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
