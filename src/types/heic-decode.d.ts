declare module "heic-decode" {
  type Decoded = { width: number; height: number; data: Uint8ClampedArray };
  type Lazy = { width: number; height: number; decode: () => Promise<Decoded> };
  function decode(opts: { buffer: Uint8Array }): Promise<Decoded>;
  namespace decode {
    function all(opts: { buffer: Uint8Array }): Promise<Lazy[] & { dispose: () => void }>;
  }
  export default decode;
}
