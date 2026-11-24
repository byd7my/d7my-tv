import { requireNativeModule } from 'expo';

export type HttpResult = { status: number; location: string; body: string };
export type Frame = { width: number; height: number; base64: string };
export type TextResult = { text: string; confidence: number };

type Native = {
  httpGet(url: string, timeoutSeconds: number): Promise<HttpResult>;
  frameRGBA(path: string, maxWidth: number): Promise<Frame>;
  frameCrop(path: string, x: number, y: number, w: number, h: number, maxWidth: number): Promise<Frame>;
  readText(path: string, x: number, y: number, w: number, h: number): Promise<TextResult>;
  tempDir(): string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export default requireNativeModule<Native>('D7TNative');
