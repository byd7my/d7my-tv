import { Injectable } from '@angular/core';
import { normalizeForOcr, ocrScaleFor } from './ocr-preprocess';

export interface OcrImage {
    width: number;
    height: number;
    /** RGBA */
    data: Uint8ClampedArray;
}

export interface OcrReading {
    text: string;
    /** 0..100 as reported by the engine. */
    confidence: number;
}

/** Minimal surface of a tesseract.js worker that this service uses. */
interface OcrWorker {
    recognize(image: HTMLCanvasElement): Promise<{
        data: { text: string; confidence: number };
    }>;
    terminate(): Promise<unknown>;
}

/** Looks like a match clock ("87:43", "45+2"). */
const CLOCK_SHAPE = /^\d{1,3}(?::\d{2}|\+\d{1,2}(?::\d{2})?)$/;
/** Stands in when the engine reports no confidence of its own. */
const SHAPE_CONFIDENCE = 70;

/**
 * The digit-only LSTM line mode often reports a confidence of exactly 0 even
 * for a perfect read, so a 0 is "unknown", not "wrong": a text that has the
 * shape of a clock gets a modest default, and the clock tracker raises trust
 * as consecutive readings agree.
 */
export function effectiveConfidence(text: string, reported: number): number {
    if (Number.isFinite(reported) && reported > 0) return reported;
    return CLOCK_SHAPE.test(text.replace(/\s+/g, '')) ? SHAPE_CONFIDENCE : 0;
}

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

    async recognize(image: OcrImage): Promise<OcrReading> {
        const worker = await this.ensureWorker();
        const { data } = await worker.recognize(this.toCanvas(image));
        const text = (data.text ?? '').trim();
        return { text, confidence: effectiveConfidence(text, data.confidence) };
    }

    /** Frees the engine; the next `recognize` loads it again. */
    async dispose(): Promise<void> {
        const pending = this.worker;
        this.worker = null;
        if (!pending) return;
        try {
            await (await pending).terminate();
        } catch {
            // already gone
        }
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
            // 7 = a single text line (PSM.SINGLE_LINE).
            tessedit_pageseg_mode: '7' as never,
        });
        return worker as unknown as OcrWorker;
    }

    private toCanvas(image: OcrImage): HTMLCanvasElement {
        const source = document.createElement('canvas');
        source.width = image.width;
        source.height = image.height;
        const sourceContext = source.getContext('2d');
        if (!sourceContext) throw new Error('2D canvas unavailable');
        sourceContext.putImageData(
            new ImageData(normalizeForOcr(image.data), image.width, image.height),
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
