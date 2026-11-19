import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { pngFromRgb } from './raster.js';

test('constructs a PNG from bounded raw RGB pixels', () => {
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const png = pngFromRgb({ width: 2, height: 2, rgb: pixels.toString('base64') });
  assert.deepEqual(png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  const length = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT');
  assert.deepEqual(inflateSync(png.subarray(41, 41 + length)), Buffer.from([0, ...pixels.subarray(0, 6), 0, ...pixels.subarray(6)]));
});

test('rejects malformed or oversized image transports', () => {
  for (const input of [
    { width: 1, height: 1, rgb: 'AA==' }, { width: 1, height: 1, rgb: '!!!!' },
    { width: 0, height: 1, rgb: '' }, { width: 8192, height: 8192, rgb: '' },
    { width: 1.2, height: 1, rgb: 'AAAA' },
  ]) assert.throws(() => pngFromRgb(input));
});
