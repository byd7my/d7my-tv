/**
 * Last-resort preparation for a clock the plain way could not read: the picture
 * is cut to black and white, and only the shapes that look like the clock's
 * characters are kept. A logo, a banner edge or a team name beside the clock
 * (which the OCR engine reads as noise and loses the digits to) is dropped,
 * and the digits are cropped tight so the engine sees one clean line.
 */

export interface IsolatedClock {
    /** One byte per pixel: 0 = ink, 255 = paper. */
    pixels: Uint8Array;
    width: number;
    height: number;
}

export interface Part {
    id: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    area: number;
}

export const partWidth = (p: Part) => p.x1 - p.x0 + 1;
export const partHeight = (p: Part) => p.y1 - p.y0 + 1;
const centreY = (p: Part) => (p.y0 + p.y1) / 2;

/** Smallest characters worth reading, as a share of the area's height. */
const MIN_CHAR_SHARE = 0.12;
const MIN_CHAR_PX = 6;
/** A character is never wider than this many heights ("W", "0" are < 1). */
const MAX_ASPECT = 1.3;
/** Characters of one clock differ in height by less than this factor. */
const HEIGHT_SPREAD = 1.33;
/** Share of the box ink must fill for a shape to count as a character. */
const MIN_FILL = 0.15;

/** The brightness that best splits dark from light (Otsu's method). */
export function otsuThreshold(luminance: Uint8ClampedArray): number {
    const histogram = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < luminance.length; i++) {
        histogram[luminance[i]]++;
        sum += luminance[i];
    }
    const total = luminance.length;
    let sumBelow = 0;
    let below = 0;
    let best = -1;
    let threshold = 128;
    for (let level = 0; level < 256; level++) {
        below += histogram[level];
        if (below === 0) continue;
        const above = total - below;
        if (above === 0) break;
        sumBelow += level * histogram[level];
        const meanBelow = sumBelow / below;
        const meanAbove = (sum - sumBelow) / above;
        const spread =
            below * above * (meanBelow - meanAbove) * (meanBelow - meanAbove);
        if (spread > best) {
            best = spread;
            threshold = level;
        }
    }
    return threshold;
}

/** Groups touching ink pixels (8-neighbourhood) into shapes. */
export function shapesIn(
    ink: Uint8Array,
    width: number,
    height: number
): { labels: Int32Array; parts: Part[] } {
    const labels = new Int32Array(width * height).fill(-1);
    const parts: Part[] = [];
    const stack: number[] = [];
    for (let start = 0; start < ink.length; start++) {
        if (!ink[start] || labels[start] >= 0) continue;
        const id = parts.length;
        const part: Part = {
            id,
            x0: width,
            y0: height,
            x1: 0,
            y1: 0,
            area: 0,
        };
        labels[start] = id;
        stack.push(start);
        while (stack.length > 0) {
            const at = stack.pop() as number;
            const x = at % width;
            const y = (at - x) / width;
            part.area++;
            if (x < part.x0) part.x0 = x;
            if (x > part.x1) part.x1 = x;
            if (y < part.y0) part.y0 = y;
            if (y > part.y1) part.y1 = y;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                        continue;
                    }
                    const next = ny * width + nx;
                    if (ink[next] && labels[next] < 0) {
                        labels[next] = id;
                        stack.push(next);
                    }
                }
            }
        }
        parts.push(part);
    }
    return { labels, parts };
}

/**
 * The biggest group of character-like shapes that share a height and a line:
 * the digits of the clock. Needs at least two (a clock has "1:2" at least).
 */
function clockDigits(parts: Part[], height: number): Part[] | null {
    const candidates = parts.filter((p) => {
        const h = partHeight(p);
        const w = partWidth(p);
        return (
            h >= Math.max(MIN_CHAR_PX, height * MIN_CHAR_SHARE) &&
            h <= height * 0.95 &&
            w >= 2 &&
            w <= h * MAX_ASPECT &&
            p.area >= w * h * MIN_FILL
        );
    });
    let best: Part[] | null = null;
    let bestScore = 0;
    for (const anchor of candidates) {
        const h = partHeight(anchor);
        const group = candidates.filter((other) => {
            const oh = partHeight(other);
            return (
                oh >= h / HEIGHT_SPREAD &&
                oh <= h * HEIGHT_SPREAD &&
                Math.abs(centreY(other) - centreY(anchor)) < h * 0.5
            );
        });
        if (group.length < 2) continue;
        const meanHeight =
            group.reduce((sum, p) => sum + partHeight(p), 0) / group.length;
        const score = group.length * 1000 + meanHeight;
        if (score > bestScore) {
            bestScore = score;
            best = group;
        }
    }
    return best;
}

/**
 * Cuts the picture to the clock's characters in the given ink colour, or
 * null when no line of characters is there. `ink` is the colour of the
 * digits: dark on a light box, or light on a dark one.
 */
export function isolateClock(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    ink: 'dark' | 'light'
): IsolatedClock | null {
    const pixelCount = width * height;
    if (pixelCount === 0 || rgba.length < pixelCount * 4) return null;
    const luminance = new Uint8ClampedArray(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        luminance[i] = Math.round(
            0.299 * rgba[i * 4] +
                0.587 * rgba[i * 4 + 1] +
                0.114 * rgba[i * 4 + 2]
        );
    }
    const threshold = otsuThreshold(luminance);
    const mask = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        mask[i] = (
            ink === 'dark'
                ? luminance[i] <= threshold
                : luminance[i] > threshold
        )
            ? 1
            : 0;
    }

    const { labels, parts } = shapesIn(mask, width, height);
    const digits = clockDigits(parts, height);
    if (!digits) return null;

    const x0 = Math.min(...digits.map((p) => p.x0));
    const x1 = Math.max(...digits.map((p) => p.x1));
    const y0 = Math.min(...digits.map((p) => p.y0));
    const y1 = Math.max(...digits.map((p) => p.y1));
    const span = y1 - y0 + 1;

    const keep = new Set(digits.map((p) => p.id));
    // The colon's dots and a "+" are smaller than the digits but sit inside
    // their box.
    for (const part of parts) {
        if (keep.has(part.id)) continue;
        if (
            part.x0 >= x0 - 2 &&
            part.x1 <= x1 + 2 &&
            part.y0 >= y0 &&
            part.y1 <= y1 &&
            partHeight(part) <= span * 0.6 &&
            partWidth(part) <= span * 0.6 &&
            part.area >= 4
        ) {
            keep.add(part.id);
        }
    }

    const margin = Math.round(span * 0.25) + 4;
    const outWidth = x1 - x0 + 1 + margin * 2;
    const outHeight = span + margin * 2;
    const pixels = new Uint8Array(outWidth * outHeight).fill(255);
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            if (keep.has(labels[y * width + x])) {
                pixels[(y - y0 + margin) * outWidth + (x - x0 + margin)] = 0;
            }
        }
    }
    return { pixels, width: outWidth, height: outHeight };
}
