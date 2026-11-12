import { Injectable } from '@angular/core';
import {
    effectiveConfidence,
    recognizeClock,
    type OcrPass,
    type OcrReading,
} from './match-clock-ocr-passes';
import { normalizeForOcr, ocrScaleFor } from './ocr-preprocess';

export { effectiveConfidence };
export type { OcrReading };

export interface OcrImage {
    width: number;
    height: number;
    /** RGBA */
    data: Uint8ClampedArray;
}

/** Minimal surface of a tesseract.js worker that this service uses. */
interface OcrWorker {
    recognize(image: HTMLCanvasElement): Promise<{
        data: { text: string; confidence: number };
    }>;
    setParameters(params: Record<string, string>): Promise<unknown>;
    terminate(): Promise<unknown>;
}

const PAGE_SEG_MODE = { line: '7', sparse: '11' } as const;

type TesseractApi = typeof import('tesseract.js');

/**
 * tesseract.js is a CommonJS package. Depending on the bundler, its exports
 * arrive on the module itself or only under `default`; the installed app got
 * the second shape and "createWorker is not a function" stopped every clock
 * reading.
 */
export function tesseractApi(module: unknown): TesseractApi {
    const direct = module as Partial<TesseractApi>;
    if (typeof direct.createWorker === 'function') return direct as TesseractApi;
    const nested = (module as { default?: Partial<TesseractApi> }).default;
    if (nested && typeof nested.createWorker === 'function') {
        return nested as TesseractApi;
    }
    throw new Error('tesseract.js did not expose createWorker');
}

const ASSET_FOLDER = 'assets/ocr/';
const PADDING = 12;

/**
 * Offline OCR for the match clock. The engine (tesseract.js, its WebAssembly
 * core and the English model) is shipped inside the app and only loaded the
 * first time the audio-sync window needs it, so playback never pays for it.
 * One worker is reused; it runs off the main thread, so reading the clock
 * does not touch the smoothness of the picture.
 */
@Injectable({ providedIn: 'root' })
export class MatchClockOcrService {
    private worker: Promise<OcrWorker> | null = null;
    /** The page mode the worker is in now (it is switched only when needed). */
    private mode: OcrPass['mode'] | null = null;
    /** The way that read a clock last: tried first next time. */
    private lastPass: OcrPass | null = null;
    /** One reading at a time: a reading switches the worker's mode. */
    private queue: Promise<unknown> = Promise.resolve();

    recognize(image: OcrImage): Promise<OcrReading> {
        const run = () => this.recognizeNow(image);
        const result = this.queue.then(run, run);
        this.queue = result.catch(() => undefined);
        return result;
    }

    /** Frees the engine; the next `recognize` loads it again. */
    async dispose(): Promise<void> {
        const pending = this.worker;
        this.worker = null;
        this.mode = null;
        if (!pending) return;
        try {
            await (await pending).terminate();
        } catch {
            // already gone
        }
    }

    private async recognizeNow(image: OcrImage): Promise<OcrReading> {
        const worker = await this.ensureWorker();
        // A tight box around the digits reads as one line; a whole scoreboard
        // needs a search for the clock among its scores and names.
        const { reading, pass } = await recognizeClock(async (pass) => {
            await this.useMode(worker, pass.mode);
            const { data } = await worker.recognize(
                this.toCanvas(image, pass.flip)
            );
            return { text: data.text ?? '', confidence: data.confidence };
        }, this.lastPass);
        if (pass) this.lastPass = pass;
        return reading;
    }

    private async useMode(
        worker: OcrWorker,
        mode: OcrPass['mode']
    ): Promise<void> {
        if (this.mode === mode) return;
        await worker.setParameters({
            tessedit_pageseg_mode: PAGE_SEG_MODE[mode],
        });
        this.mode = mode;
    }

    private ensureWorker(): Promise<OcrWorker> {
        if (!this.worker) {
            this.worker = this.createWorker().catch((error: unknown) => {
                this.worker = null;
                throw error;
            });
        }
        return this.worker;
    }

    private async createWorker(): Promise<OcrWorker> {
        const tesseract = tesseractApi(await import('tesseract.js'));
        const base = new URL(ASSET_FOLDER, document.baseURI).href;
        const worker = await tesseract.createWorker('eng', 1, {
            workerPath: `${base}worker.min.js`,
            corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
            langPath: base.replace(/\/$/, ''),
            gzip: true,
            workerBlobURL: false,
            cacheMethod: 'none',
        });
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789:+',
            tessedit_pageseg_mode: PAGE_SEG_MODE.line as never,
        });
        this.mode = 'line';
        return worker as unknown as OcrWorker;
    }

    private toCanvas(image: OcrImage, flip: boolean): HTMLCanvasElement {
        const source = document.createElement('canvas');
        source.width = image.width;
        source.height = image.height;
        const sourceContext = source.getContext('2d');
        if (!sourceContext) throw new Error('2D canvas unavailable');
        sourceContext.putImageData(
            new ImageData(
                normalizeForOcr(image.data, flip),
                image.width,
                image.height
            ),
            0,
            0
        );

        const scale = ocrScaleFor(image.height);
        const canvas = document.createElement('canvas');
        canvas.width = image.width * scale + PADDING * 2;
        canvas.height = image.height * scale + PADDING * 2;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('2D canvas unavailable');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(
            source,
            PADDING,
            PADDING,
            image.width * scale,
            image.height * scale
        );
        return canvas;
    }
}
