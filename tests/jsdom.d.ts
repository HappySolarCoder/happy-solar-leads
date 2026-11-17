declare module "jsdom" {
  interface JSDOMOptions {
    pretendToBeVisual?: boolean;
    url?: string;
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis;
  }
}
