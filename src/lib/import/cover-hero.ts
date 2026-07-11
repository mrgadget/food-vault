import jpeg from "jpeg-js";

/**
 * Decode a meal-kit card's cover photograph to a small hero JPEG, reading only
 * the low-frequency content of each 8×8 block.
 *
 * The cover is ~9 megapixels of Adobe inverted-CMYK (YCCK). A full decode needs
 * ~200MB of buffers — more than a Worker's 128MB isolate — and the Cloudflare
 * Images binding renders the inverted CMYK as a colour negative. Neither works.
 *
 * A baseline JPEG is a grid of 8×8 blocks, each a small inverse DCT. Rather than
 * reconstruct every block to full 8×8 resolution (the expensive part), this
 * reconstructs each to just 2×2 — the average of each of its four quadrants,
 * which is a linear combination of the block's DCT coefficients. That yields a
 * quarter-resolution image (~870px wide here) with proper area-averaging, for a
 * few megabytes, entirely within the isolate. A block is processed and thrown
 * away before the next is read, so only one block of coefficients is ever live.
 *
 * Supports the format these cards actually use: baseline (SOF0/1), 8-bit, no
 * chroma subsampling. Anything else throws, and the caller simply stores no
 * hero rather than a wrong one.
 */
export function decodeCoverToJpeg(bytes: Uint8Array): Uint8Array {
  const { width, height, planes, components, adobeTransform } = decodeScaled(bytes);
  const rgba = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = toRgb(planes, i, components, adobeTransform);
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }

  return jpeg.encode({ data: rgba, width, height }, 85).data;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * One reconstructed sample per component → an RGB pixel.
 *
 * Four components is Adobe YCCK: the first three are YCbCr that convert to the
 * inverted CMY channels (255 − ink), and the fourth is black, stored inverted
 * too, so the display value is the ordinary subtractive `channel × K`. Three
 * components is YCbCr unless an Adobe marker says the data is already RGB; one
 * is greyscale.
 */
function toRgb(
  planes: Float32Array[],
  i: number,
  components: number,
  adobeTransform: number,
): [number, number, number] {
  if (components === 1) {
    const y = clamp(planes[0][i]);
    return [y, y, y];
  }

  const Y = planes[0][i];
  const Cb = planes[1][i] - 128;
  const Cr = planes[2][i] - 128;
  // Adobe transform 0 on a three-component image means the samples are RGB, not
  // YCbCr; every other case (and the absence of a marker) is YCbCr.
  const asRgb = components === 3 && adobeTransform === 0;
  const r = asRgb ? planes[0][i] : Y + 1.402 * Cr;
  const g = asRgb ? planes[1][i] : Y - 0.344136 * Cb - 0.714136 * Cr;
  const b = asRgb ? planes[2][i] : Y + 1.772 * Cb;

  if (components === 4) {
    const k = 255 - planes[3][i]; // black is stored inverted, like the CMY channels
    return [clamp((clamp(r) * k) / 255), clamp((clamp(g) * k) / 255), clamp((clamp(b) * k) / 255)];
  }
  return [clamp(r), clamp(g), clamp(b)];
}

// Zig-zag scan order → natural (row-major) block index, per the JPEG spec.
const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/**
 * Averaging weights: QUAD_W[q][k] is the mean, over the four sample positions of
 * output-half q, of the k-th 1D inverse-DCT basis. A block quadrant's average is
 * the separable product of these across the two dimensions, so two of them turn
 * a coefficient block into one 2×2 output tile. QUAD_W[q][0] alone reproduces the
 * plain DC-average (block mean), with the higher terms adding quadrant detail.
 */
const QUAD_W = buildQuadWeights();
function buildQuadWeights(): [Float64Array, Float64Array] {
  const w: [Float64Array, Float64Array] = [new Float64Array(8), new Float64Array(8)];
  for (let q = 0; q < 2; q++) {
    for (let k = 0; k < 8; k++) {
      const alpha = k === 0 ? Math.SQRT1_2 : 1;
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const x = q * 4 + j;
        sum += Math.cos(((2 * x + 1) * k * Math.PI) / 16);
      }
      // (1/4) average × (1/2) IDCT scale × alpha.
      w[q][k] = (alpha * sum) / 8;
    }
  }
  return w;
}

type Frame = {
  width: number;
  height: number;
  components: { id: number; hs: number; vs: number; tq: number }[];
};

/** A canonical Huffman table as a length|code → value map. */
type HuffTable = Record<number, number>;

function buildHuff(counts: number[], values: number[]): HuffTable {
  const table: HuffTable = {};
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) table[(len << 16) | code++] = values[k++];
    code <<= 1;
  }
  return table;
}

/**
 * Parse the JPEG down to its scan, then walk every block reconstructing a 2×2
 * tile. Returns one quarter-resolution plane of samples per component.
 */
function decodeScaled(data: Uint8Array): {
  width: number;
  height: number;
  planes: Float32Array[];
  components: number;
  adobeTransform: number;
} {
  let p = 2; // past the SOI marker
  const quant: Record<number, Int32Array> = {};
  const huffDC: Record<number, HuffTable> = {};
  const huffAC: Record<number, HuffTable> = {};
  let frame: Frame | null = null;
  let resetInterval = 0;
  let adobeTransform = -1;

  const u16 = () => {
    const v = (data[p] << 8) | data[p + 1];
    p += 2;
    return v;
  };

  while (p < data.length) {
    if (data[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = data[p + 1];
    p += 2;

    if (marker === 0xd9) break; // EOI
    if (marker === 0xc2) throw new Error("progressive JPEG is not supported");

    if (marker === 0xdd) {
      u16();
      resetInterval = u16();
    } else if (marker === 0xee) {
      // APP14 Adobe: the colour transform is the segment's last byte. `u16`
      // consumed the 2-byte length, so the payload runs (len - 2) bytes from p.
      const len = u16();
      adobeTransform = data[p + (len - 2) - 1];
      p += len - 2;
    } else if (marker === 0xdb) {
      const end = p + u16() - 2;
      while (p < end) {
        const pq = data[p] >> 4;
        const tq = data[p] & 15;
        p++;
        const t = new Int32Array(64);
        for (let i = 0; i < 64; i++) t[i] = pq ? u16() : data[p++];
        quant[tq] = t;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      u16();
      p++; // precision
      const height = u16();
      const width = u16();
      const nc = data[p++];
      const components: Frame["components"] = [];
      for (let i = 0; i < nc; i++) {
        const id = data[p++];
        const samp = data[p++];
        components.push({ id, hs: samp >> 4, vs: samp & 15, tq: data[p++] });
      }
      if (components.some((c) => c.hs !== 1 || c.vs !== 1)) {
        throw new Error("chroma subsampling is not supported");
      }
      frame = { width, height, components };
    } else if (marker === 0xc4) {
      const end = p + u16() - 2;
      while (p < end) {
        const tc = data[p] >> 4;
        const th = data[p] & 15;
        p++;
        const counts: number[] = [];
        let total = 0;
        for (let i = 0; i < 16; i++) {
          counts.push(data[p]);
          total += data[p];
          p++;
        }
        const values: number[] = [];
        for (let i = 0; i < total; i++) values.push(data[p++]);
        (tc === 0 ? huffDC : huffAC)[th] = buildHuff(counts, values);
      }
    } else if (marker === 0xda) {
      if (!frame) throw new Error("scan before frame header");
      u16();
      const ns = data[p++];
      const scan: { comp: Frame["components"][number]; dc: number; ac: number }[] = [];
      for (let i = 0; i < ns; i++) {
        const cs = data[p++];
        const t = data[p++];
        const comp = frame.components.find((c) => c.id === cs);
        if (!comp) throw new Error("scan names an unknown component");
        scan.push({ comp, dc: t >> 4, ac: t & 15 });
      }
      p += 3; // Ss, Se, Ah/Al
      const blocksW = Math.ceil(frame.width / 8);
      const blocksH = Math.ceil(frame.height / 8);
      const planes = walkScan(data, p, blocksW, blocksH, scan, quant, huffDC, huffAC, resetInterval);
      return {
        width: blocksW * 2,
        height: blocksH * 2,
        planes,
        components: frame.components.length,
        adobeTransform,
      };
    } else {
      // Any other segment (APP0, COM, …) carries a length; skip it.
      p += u16() - 2;
    }
  }
  throw new Error("no scan found");
}

function walkScan(
  data: Uint8Array,
  start: number,
  blocksW: number,
  blocksH: number,
  scan: { comp: Frame["components"][number]; dc: number; ac: number }[],
  quant: Record<number, Int32Array>,
  huffDC: Record<number, HuffTable>,
  huffAC: Record<number, HuffTable>,
  resetInterval: number,
): Float32Array[] {
  const outW = blocksW * 2;
  const planes = scan.map(() => new Float32Array(outW * blocksH * 2));

  let bytePos = start;
  let bitBuf = 0;
  let bitCnt = 0;

  const readBit = (): number => {
    if (bitCnt === 0) {
      let b = data[bytePos++];
      if (b === 0xff) {
        const next = data[bytePos];
        if (next === 0x00) bytePos++; // a stuffed 0xFF
        else if (next >= 0xd0 && next <= 0xd7) {
          /* restart marker; handled at the block boundary */
        } else b = 0; // ran into a real marker — feed zeros
      }
      bitBuf = b;
      bitCnt = 8;
    }
    bitCnt--;
    return (bitBuf >> bitCnt) & 1;
  };
  const receive = (n: number): number => {
    let v = 0;
    while (n-- > 0) v = (v << 1) | readBit();
    return v;
  };
  const extend = (v: number, n: number): number => (v < 1 << (n - 1) ? v + (-1 << n) + 1 : v);
  const huffDecode = (table: HuffTable): number => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | readBit();
      const value = table[(len << 16) | code];
      if (value !== undefined) return value;
    }
    throw new Error("invalid Huffman code");
  };
  const skipRestart = () => {
    bitCnt = 0; // byte-align
    while (!(data[bytePos] === 0xff && data[bytePos + 1] >= 0xd0 && data[bytePos + 1] <= 0xd7)) {
      bytePos++;
    }
    bytePos += 2;
  };

  const coef = new Float64Array(64); // one block, natural order, dequantized
  const colAvg = new Float64Array(16); // [row*2 + qx] partial row averages
  const pred = scan.map(() => 0);
  let mcu = 0;

  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      if (resetInterval && mcu > 0 && mcu % resetInterval === 0) {
        skipRestart();
        pred.fill(0);
      }
      for (let s = 0; s < scan.length; s++) {
        const q = quant[scan[s].comp.tq];
        coef.fill(0);
        const t = huffDecode(huffDC[scan[s].dc]);
        pred[s] += t ? extend(receive(t), t) : 0;
        coef[0] = pred[s] * q[0];
        for (let k = 1; k < 64; ) {
          const rs = huffDecode(huffAC[scan[s].ac]);
          const run = rs >> 4;
          const size = rs & 15;
          if (size === 0) {
            if (run === 15) {
              k += 16;
              continue;
            }
            break;
          }
          k += run;
          if (k > 63) break;
          coef[ZIGZAG[k]] = extend(receive(size), size) * q[k];
          k++;
        }

        // Reduce the coefficient block to a 2×2 tile of quadrant averages, using
        // the separable weights: first collapse columns per row, then rows.
        for (let row = 0; row < 8; row++) {
          let c0 = 0;
          let c1 = 0;
          const base = row * 8;
          for (let col = 0; col < 8; col++) {
            const v = coef[base + col];
            if (v !== 0) {
              c0 += QUAD_W[0][col] * v;
              c1 += QUAD_W[1][col] * v;
            }
          }
          colAvg[row * 2] = c0;
          colAvg[row * 2 + 1] = c1;
        }
        const plane = planes[s];
        for (let qy = 0; qy < 2; qy++) {
          const wy = QUAD_W[qy];
          let a0 = 0;
          let a1 = 0;
          for (let row = 0; row < 8; row++) {
            a0 += wy[row] * colAvg[row * 2];
            a1 += wy[row] * colAvg[row * 2 + 1];
          }
          const o = (by * 2 + qy) * outW + bx * 2;
          plane[o] = a0 + 128;
          plane[o + 1] = a1 + 128;
        }
      }
      mcu++;
    }
  }
  return planes;
}
