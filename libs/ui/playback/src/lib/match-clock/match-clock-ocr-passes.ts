import { findClockInText } from './match-clock-text';

export interface OcrReading {
    text: string;
    /** 0..100 as reported by the engine. */
    confidence: number;
}

/** Looks like a match clock ("87:43", "45+2"). */
const CLOCK_SHAPE = /^\d{1,3}(?::\d{2}|\+\d{1,2}(?::\d{2})?)$/;
/** Stands in when the engine reports no confidence of its own. */
export const SHAPE_CONFIDENCE = 70;

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

/**
 * One way of reading the same area. `line` takes it as a single line of text
 * (a tight box around the digits); `sparse` looks for text anywhere in it (a
 * whole scoreboard). `flip` turns the light/dark guess around, for a clock in
 * a light box inside a mostly dark scoreboard.
 */
export interface OcrPass {
    mode: 'line' | 'sparse';
    flip: boolean;
}

export const OCR_PASSES: readonly OcrPass[] = [
    { mode: 'line', flip: false },
    { mode: 'sparse', flip: false },
    { mode: 'sparse', flip: true },
    { mode: 'line', flip: true },
];

export interface RawOcr {
    text: string;
    confidence: number;
}

function same(a: OcrPass, b: OcrPass): boolean {
    return a.mode === b.mode && a.flip === b.flip;
}

/**
 * Reads the clock with the way that worked last time first, then the others,
 * until one finds a clock in the text. When none does, the first reading is
 * returned as it came (the caller treats it as "not a clock").
 */
export async function recognizeClock(
    run: (pass: OcrPass) => Promise<RawOcr>,
    preferred: OcrPass | null
): Promise<{ reading: OcrReading; pass: OcrPass | null }> {
    const order = preferred
        ? [preferred, ...OCR_PASSES.filter((pass) => !same(pass, preferred))]
        : OCR_PASSES;
    let first: OcrReading | null = null;
    for (const pass of order) {
        const raw = await run(pass);
        const text = raw.text.trim();
        const found = findClockInText(text);
        if (found) {
            // The clock was the whole answer: the engine's own confidence
            // counts. Found among other text: the average is about the rest.
            const whole = text.replace(/\s+/g, '') === found;
            return {
                reading: {
                    text: found,
                    confidence: whole
                        ? effectiveConfidence(found, raw.confidence)
                        : SHAPE_CONFIDENCE,
                },
                pass,
            };
        }
        first ??= {
            text,
            confidence: effectiveConfidence(text, raw.confidence),
        };
    }
    return { reading: first ?? { text: '', confidence: 0 }, pass: null };
}
