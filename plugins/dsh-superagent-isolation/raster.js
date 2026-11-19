import { deflateSync } from 'node:zlib';

const MAX_PIXELS = 4_194_304;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const output = Buffer.allocUnsafe(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return output;
}

export function pngFromRgb(input) {
  const { width, height, rgb } = input ?? {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width > 8192 || height > 8192 || width * height > MAX_PIXELS || typeof rgb !== 'string') {
    throw new Error('invalid isolated raster dimensions');
  }
  const bytes = width * height * 3;
  if (rgb.length !== Math.ceil(bytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rgb)) throw new Error('invalid isolated raster encoding');
  const pixels = Buffer.from(rgb, 'base64');
  if (pixels.length !== bytes || pixels.toString('base64') !== rgb) throw new Error('invalid isolated raster bytes');
  const rows = Buffer.allocUnsafe(bytes + height);
  for (let row = 0; row < height; row++) {
    const destination = row * (width * 3 + 1);
    rows[destination] = 0;
    pixels.copy(rows, destination + 1, row * width * 3, (row + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
