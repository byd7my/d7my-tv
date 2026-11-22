import { partHeight, partWidth, shapesIn, type Part } from './ocr-isolate';

/**
 * Finds where a match clock ("63:08") could be in a whole video frame, so the
 * person does not have to draw a box for every broadcaster's design. A clock
 * has one telltale: a colon, two small squares stacked on top of each other,
 * with digit-sized shapes on both sides. The frame is cut to black and white at
 * several brightness levels (a clock is dark on light or light on dark, in
 * any scoreboard colour) and each level is searched for that pattern.
 */

export interface ClockBox {
    /** 0..1 of the frame. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** More digits around a colon is a likelier clock. */
    score: number;
}

/** The frame is searched at about this width; a clock stays readable. */
const SEARCH_WIDTH = 1280;
const LEVELS = [48, 80, 112, 144, 176, 208];
const MAX_CANDIDATES = 6;
/** Digits next to a colon, per side, at most ("123:45" is not a clock). */
const MAX_PER_SIDE = 3;

interface Grid {
    luminance: Uint8ClampedArray;
    width: number;
    height: number;
}

/** The frame as brightness only, shrunk (averaged) to the search size. */
function toGrid(rgba: Uint8ClampedArray, width: number, height: number): Grid {
    const factor = Math.max(1, Math.floor(width / SEARCH_WIDTH));
    const w = Math.floor(width / factor);
    const h = Math.floor(height / factor);
    const luminance = new Uint8ClampedArray(w * h);
    const area = factor * factor;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let dy = 0; dy < factor; dy++) {
                for (let dx = 0; dx < factor; dx++) {
                    const at =
                        ((y * factor + dy) * width + x * factor + dx) * 4;
                    sum +=
                        0.299 * rgba[at] +
                        0.587 * rgba[at + 1] +
                        0.114 * rgba[at + 2];
                }
            }
            luminance[y * w + x] = Math.round(sum / area);
        }
    }
    return { luminance, width: w, height: h };
}

const isDot = (p: Part): boolean => {
    const w = partWidth(p);
    const h = partHeight(p);
    return (
        w >= 2 &&
        h >= 2 &&
        w <= 40 &&
        h <= 40 &&
        w / h >= 0.5 &&
        w / h <= 2 &&
        p.area >= w * h * 0.5
    );
};

const isDigit = (p: Part): boolean => {
    const w = partWidth(p);
    const h = partHeight(p);
    return (
        h >= 8 && h <= 200 && w >= 2 && w <= h * 1.3 && p.area >= w * h * 0.15
    );
};

const centre = (p: Part) => ({ x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 });

/** Two dots stacked: similar, one above the other, a gap about their size. */
function colonsIn(dots: Part[]): Array<{ top: Part; bottom: Part }> {
    const sorted = [...dots].sort((a, b) => a.x0 - b.x0);
    const found: Array<{ top: Part; bottom: Part }> = [];
    for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const reach = Math.max(3, partWidth(a));
        for (let j = i + 1; j < sorted.length; j++) {
            const b = sorted[j];
            if (b.x0 - a.x0 > reach) break;
            const [top, bottom] = a.y0 <= b.y0 ? [a, b] : [b, a];
            const size = Math.max(partHeight(top), partHeight(bottom));
            const gap = bottom.y0 - top.y1;
            const ratio = partHeight(top) / partHeight(bottom);
            if (
                Math.abs(centre(a).x - centre(b).x) <= size * 0.5 &&
                gap >= size * 0.6 &&
                gap <= size * 4 &&
                ratio > 0.6 &&
                ratio < 1.67
            ) {
                found.push({ top, bottom });
            }
        }
    }
    return found;
}

/** The digits in a row at one side of the colon, nearest first. */
function sideDigits(
    digits: Part[],
    from: number,
    direction: -1 | 1,
    colonY: number,
    tall: number
): Part[] {
    const row = digits
        .filter((d) => {
            const h = partHeight(d);
            const edge = direction === -1 ? d.x1 : d.x0;
            return (
                h >= tall * 0.7 &&
                h <= tall * 1.5 &&
                Math.abs(centre(d).y - colonY) <= tall * 0.35 &&
                (direction === -1 ? edge <= from : edge >= from)
            );
        })
        .sort((a, b) => direction * (a.x0 - b.x0));
    const kept: Part[] = [];
    let edge = from;
    for (const d of row) {
        const gap = direction === -1 ? edge - d.x1 : d.x0 - edge;
        if (gap > tall * 0.9) break;
        kept.push(d);
        edge = direction === -1 ? d.x0 : d.x1;
        if (kept.length === MAX_PER_SIDE) break;
    }
    return kept;
}

function boxesAt(grid: Grid, level: number, ink: 'dark' | 'light'): ClockBox[] {
    const size = grid.width * grid.height;
    const mask = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        const value = grid.luminance[i];
        mask[i] = (ink === 'dark' ? value <= level : value > level) ? 1 : 0;
    }
    const { parts } = shapesIn(mask, grid.width, grid.height);
    const dots = parts.filter(isDot);
    // A busy field has thousands of specks: more than this is not a scoreboard.
    if (dots.length > 4000) return [];
    const digits = parts.filter(isDigit);
    const boxes: ClockBox[] = [];
    for (const { top, bottom } of colonsIn(dots)) {
        const span = bottom.y1 - top.y0 + 1;
        const colonY = (top.y0 + bottom.y1) / 2;
        const colonLeft = Math.min(top.x0, bottom.x0);
        const colonRight = Math.max(top.x1, bottom.x1);
        // A digit is about twice as tall as the colon's two dots are far apart.
        for (const tall of [span * 1.6, span * 2.2, span * 3]) {
            const left = sideDigits(digits, colonLeft, -1, colonY, tall);
            const right = sideDigits(digits, colonRight, 1, colonY, tall);
            if (left.length === 0 || right.length === 0) continue;
            const all = [...left, ...right, top, bottom];
            const x0 = Math.min(...all.map((p) => p.x0));
            const x1 = Math.max(...all.map((p) => p.x1));
            const y0 = Math.min(...all.map((p) => p.y0));
            const y1 = Math.max(...all.map((p) => p.y1));
            const padX = Math.round((y1 - y0 + 1) * 0.3);
            const padY = Math.round((y1 - y0 + 1) * 0.25);
            const bx = Math.max(0, x0 - padX);
            const by = Math.max(0, y0 - padY);
            const bw = Math.min(grid.width, x1 + padX + 1) - bx;
            const bh = Math.min(grid.height, y1 + padY + 1) - by;
            boxes.push({
                x: bx / grid.width,
                y: by / grid.height,
                width: bw / grid.width,
                height: bh / grid.height,
                score: left.length + right.length,
            });
            break;
        }
    }
    return boxes;
}

function overlap(a: ClockBox, b: ClockBox): number {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    const inter = w * h;
    return inter / (a.width * a.height + b.width * b.height - inter);
}

/** The likeliest places for the clock, likeliest first (at most a handful). */
export function locateClockBoxes(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
): ClockBox[] {
    if (width < 16 || height < 16 || rgba.length < width * height * 4)
        return [];
    const grid = toGrid(rgba, width, height);
    const all: ClockBox[] = [];
    for (const level of LEVELS) {
        for (const ink of ['dark', 'light'] as const) {
            all.push(...boxesAt(grid, level, ink));
        }
    }
    all.sort((a, b) => b.score - a.score);
    const kept: ClockBox[] = [];
    for (const box of all) {
        if (kept.some((other) => overlap(box, other) > 0.4)) continue;
        kept.push(box);
        if (kept.length === MAX_CANDIDATES) break;
    }
    return kept;
}
