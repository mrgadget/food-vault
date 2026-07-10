/** Minimal typings for the vendored jpeg-js decoder. See jpeg-decoder.js. */
export declare class JpegImage {
  width: number;
  height: number;
  opts: Record<string, unknown>;
  parse(data: Uint8Array): void;
  /** Four interleaved channels for a CMYK source; three for RGB. */
  getData(width: number, height: number): Uint8Array;
  static resetMaxMemoryUsage(maxBytes: number): void;
}
