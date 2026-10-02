import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { SetupError } from "../host/setup-error.js";

/** An image's pixels as RGBA, four bytes per pixel, row by row. */
export type Pixels = { readonly width: number; readonly height: number; readonly rgba: Buffer };

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel of the 8-bit colour types the capture runner writes: grey, RGB, grey with alpha and RGBA. */
const channelsOf: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** Reverses the PNG row filters and returns the raw rows without their filter bytes. */
function unfilter(data: Buffer, height: number, stride: number, channels: number, path: string): Buffer {
  if (data.length !== height * (stride + 1)) throw new SetupError(`${path}: the image data has ${data.length} bytes, not ${height * (stride + 1)}.`);
  const raw = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = data[row * (stride + 1)]!;
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let index = 0; index < stride; index++) {
      const value = data[source + index]!;
      const left = index >= channels ? raw[target + index - channels]! : 0;
      const up = row > 0 ? raw[target - stride + index]! : 0;
      const upLeft = row > 0 && index >= channels ? raw[target - stride + index - channels]! : 0;
      let predicted: number;
      switch (filter) {
        case 0: predicted = 0; break;
        case 1: predicted = left; break;
        case 2: predicted = up; break;
        case 3: predicted = (left + up) >> 1; break;
        case 4: predicted = paeth(left, up, upLeft); break;
        default: throw new SetupError(`${path}: row ${row} has the unknown filter ${filter}.`);
      }
      raw[target + index] = (value + predicted) & 0xff;
    }
  }
  return raw;
}

/** Reads a PNG file's pixels; anything but an 8-bit, non-interlaced grey, RGB, grey-alpha or RGBA image is a setup error. */
export function readPng(path: string): Pixels {
  const bytes = readFileSync(path);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) throw new SetupError(`${path} is not a PNG file.`);
  let offset = signature.length;
  let header: { width: number; height: number; channels: number } | null = null;
  const data: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new SetupError(`${path}: the ${type} chunk is cut off.`);
    if (type === "IHDR") {
      const [depth, colour, compression, filter, interlace] = [body[8], body[9], body[10], body[11], body[12]];
      const channels = colour === undefined ? undefined : channelsOf[colour];
      if (depth !== 8 || channels === undefined || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new SetupError(`${path}: only 8-bit, non-interlaced grey, RGB, grey-alpha and RGBA images are read (bit depth ${depth}, colour type ${colour}, interlace ${interlace}).`);
      }
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), channels };
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (header === null || data.length === 0) throw new SetupError(`${path}: the PNG file has no header or no image data.`);
  const { width, height, channels } = header;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(data));
  } catch (error) {
    throw new SetupError(`${path}: the image data cannot be inflated: ${(error as Error).message}`);
  }
  const raw = unfilter(inflated, height, width * channels, channels, path);
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * channels;
    const grey = channels <= 2;
    rgba[pixel * 4] = raw[at]!;
    rgba[pixel * 4 + 1] = grey ? raw[at]! : raw[at + 1]!;
    rgba[pixel * 4 + 2] = grey ? raw[at]! : raw[at + 2]!;
    rgba[pixel * 4 + 3] = channels === 2 ? raw[at + 1]! : channels === 4 ? raw[at + 3]! : 0xff;
  }
  return { width, height, rgba };
}

/** The share of pixels whose RGBA value differs between two images; 1 when their sizes differ. */
export function differingShare(left: Pixels, right: Pixels): number {
  if (left.width !== right.width || left.height !== right.height) return 1;
  const pixels = left.width * left.height;
  if (pixels === 0) return 0;
  let differing = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (left.rgba.readUInt32BE(pixel * 4) !== right.rgba.readUInt32BE(pixel * 4)) differing++;
  }
  return differing / pixels;
}
