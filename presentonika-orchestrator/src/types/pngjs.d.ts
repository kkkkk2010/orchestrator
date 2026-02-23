declare module "pngjs" {
  export class PNG {
    width: number;
    height: number;
    data: Buffer;
    constructor(opts?: any);
    static sync: { write(png: any): Buffer };
  }
}
