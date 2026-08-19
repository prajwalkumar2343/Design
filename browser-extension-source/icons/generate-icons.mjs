// Generates the Canvas Capture toolbar icons as PNGs using only Node builtins.
// Usage: node icons/generate-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BACKGROUND = [0x5d, 0x5c, 0xe2, 255]; // Canvas accent #5D5CE2
const BORDER = [0x38, 0x37, 0xa8, 255];
const GLYPH = [255, 255, 255, 255];

function inRoundedSquare(x, y, size) {
  const radius = size * 0.22;
  const half = size / 2;
  const center = size / 2;
  const dx = Math.max(Math.abs(x - center) - (half - radius), 0);
  const dy = Math.max(Math.abs(y - center) - (half - radius), 0);
  return Math.hypot(dx, dy) <= radius;
}

function inBracket(x, y, size) {
  const margin = size * 0.16;
  const arm = size * 0.3;
  const thickness = Math.max(1, size * 0.085);
  const min = margin;
  const max = size - margin;
  const horizontal = (px, py) => px >= min && px <= min + arm && py >= min && py <= min + thickness;
  const vertical = (px, py) => px >= min && px <= min + thickness && py >= min && py <= min + arm;
  const at = (cornerX, cornerY, px, py) => {
    const localX = cornerX === 0 ? px : size - px;
    const localY = cornerY === 0 ? py : size - py;
    return horizontal(localX, localY) || vertical(localX, localY);
  };
  return at(0, 0, x, y) || at(1, 0, x, y) || at(0, 1, x, y) || at(1, 1, x, y);
}

function render(size) {
  const scale = 4;
  const big = size * scale;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = x + (sx + 0.5) / scale;
          const py = y + (sy + 0.5) / scale;
          let color = null;
          if (inRoundedSquare(px, py, size)) {
            color = BACKGROUND;
            const edge = Math.abs(Math.hypot(
              Math.max(Math.abs(px - size / 2) - (size / 2 - size * 0.22), 0),
              Math.max(Math.abs(py - size / 2) - (size / 2 - size * 0.22), 0),
            ) - size * 0.22);
            if (edge < 1.1) {
              color = BORDER;
            }
            if (inBracket(px, py, size)) {
              color = GLYPH;
            }
          }
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += color[3];
          }
        }
      }
      const samples = scale * scale;
      const offset = (y * size + x) * 4;
      buffer[offset] = Math.round(r / samples);
      buffer[offset + 1] = Math.round(g / samples);
      buffer[offset + 2] = Math.round(b / samples);
      buffer[offset + 3] = Math.round(a / samples);
    }
  }
  return buffer;
}

for (const size of [16, 32, 48, 128]) {
  mkdirSync(OUT_DIR, { recursive: true });
  const png = encodePng(size, render(size));
  writeFileSync(join(OUT_DIR, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png (${png.length} bytes)`);
}
