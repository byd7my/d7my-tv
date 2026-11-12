/**
 * Prepares a scoreboard crop for the OCR engine, which reads dark text on a
 * light background best. Scoreboards are usually the opposite (white digits
 * on a dark box), so the picture is turned to greyscale, stretched to the
 * full contrast range and inverted when it is mostly dark.
 */

/** Share of the darkest/brightest pixels ignored when stretching contrast. */
const CLIP_FRACTION = 0.02;
/** Mean luminance below this means light-on-dark text. */
const DARK_MEAN = 128;

/**
 * `flip` turns the light/dark guess around: the mean of a whole scoreboard
 * can be dark while the clock sits in a light box (or the other way).
 */
export function normalizeForOcr(
    rgba: Uint8ClampedArray,
    flip = false
): Uint8ClampedArray<ArrayBuffer> {
    const pixels = rgba.length / 4;
    const luminance = new Uint8ClampedArray(pixels);
    const histogram = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < pixels; i++) {
        const value = Math.round(
            0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
        );
        luminance[i] = value;
        histogram[value]++;
        sum += value;
    }

    const clip = Math.floor(pixels * CLIP_FRACTION);
    let low = 0;
    let seen = 0;
    while (low < 255 && seen + histogram[low] <= clip) seen += histogram[low++];
    let high = 255;
    seen = 0;
    while (high > low && seen + histogram[high] <= clip) {
        seen += histogram[high--];
    }
    const range = Math.max(1, high - low);
    const invert = pixels > 0 && (sum / pixels < DARK_MEAN) !== flip;

    const out = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < pixels; i++) {
        let value = ((luminance[i] - low) * 255) / range;
        value = Math.min(255, Math.max(0, value));
        if (invert) value = 255 - value;
        out[i * 4] = value;
        out[i * 4 + 1] = value;
        out[i * 4 + 2] = value;
        out[i * 4 + 3] = 255;
    }
    return out;
}

/** Scale that brings the text height to what the OCR model likes. */
export function ocrScaleFor(height: number): number {
    const target = 72;
    return Math.min(6, Math.max(1, Math.round(target / Math.max(1, height))));
}
