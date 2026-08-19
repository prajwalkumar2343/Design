declare module "zstd-codec" {
  interface ZstdSimple {
    compress(input: Uint8Array, level?: number): Uint8Array;
    decompress(input: Uint8Array, outputSize?: number): Uint8Array;
  }
  interface ZstdBinding {
    Simple: new () => ZstdSimple;
  }
  export const ZstdCodec: {
    run(callback: (zstd: ZstdBinding) => void): void;
  };
}
