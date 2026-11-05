declare module "gifenc" {
  type Palette = number[][];

  type Encoder = {
    writeFrame(
      pixels: Uint8Array,
      width: number,
      height: number,
      options: { palette: Palette; delay?: number; repeat?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };

  const encoder: {
    GIFEncoder(): Encoder;
    applyPalette(pixels: Uint8Array, palette: Palette): Uint8Array;
    quantize(pixels: Uint8Array, colorCount: number): Palette;
  };

  export default encoder;
}
