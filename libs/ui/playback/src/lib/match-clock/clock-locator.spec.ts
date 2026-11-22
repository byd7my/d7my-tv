import { locateClockBoxes } from './clock-locator';

const W = 400;
const H = 200;

function frame(
    paint: (
        rect: (x: number, y: number, w: number, h: number, v: number) => void
    ) => void,
    field = 110
): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(W * H * 4);
    const rect = (x: number, y: number, w: number, h: number, v: number) => {
        for (let j = y; j < y + h; j++) {
            for (let i = x; i < x + w; i++) {
                const at = (j * W + i) * 4;
                rgba[at] = rgba[at + 1] = rgba[at + 2] = v;
                rgba[at + 3] = 255;
            }
        }
    };
    rect(0, 0, W, H, field);
    paint(rect);
    return rgba;
}

/** "12:34" as bars, with a two-square colon in the middle. */
function clockAt(
    rect: (x: number, y: number, w: number, h: number, v: number) => void,
    x: number,
    y: number,
    ink: number
): void {
    for (const dx of [0, 14, 56, 70]) rect(x + dx, y, 9, 24, ink);
    rect(x + 36, y + 5, 5, 5, ink);
    rect(x + 36, y + 15, 5, 5, ink);
}

describe('locateClockBoxes', () => {
    it('finds light digits on a dark box', () => {
        const rgba = frame((rect) => {
            rect(40, 30, 140, 50, 25);
            clockAt(rect, 60, 42, 245);
        });

        const [best] = locateClockBoxes(rgba, W, H);

        expect(best).toBeDefined();
        // Around the clock (x 60..139, y 42..66), inside the dark box.
        expect(best.x * W).toBeLessThanOrEqual(60);
        expect((best.x + best.width) * W).toBeGreaterThanOrEqual(139);
        expect(best.y * H).toBeLessThanOrEqual(42);
        expect((best.y + best.height) * H).toBeGreaterThanOrEqual(66);
        expect(best.width * W).toBeLessThan(160);
    });

    it('finds dark digits on a light box', () => {
        const rgba = frame((rect) => {
            rect(200, 100, 150, 60, 235);
            clockAt(rect, 220, 118, 20);
        });

        const [best] = locateClockBoxes(rgba, W, H);

        expect(best.x * W).toBeGreaterThan(190);
        expect(best.y * H).toBeGreaterThan(90);
    });

    it('finds nothing in a frame with no colon', () => {
        const rgba = frame((rect) => {
            rect(40, 30, 140, 50, 25);
            for (const dx of [0, 14, 28, 42]) rect(60 + dx, 42, 9, 24, 245);
        });

        expect(locateClockBoxes(rgba, W, H)).toEqual([]);
    });

    it('ignores a frame that is too small', () => {
        expect(locateClockBoxes(new Uint8ClampedArray(16), 2, 2)).toEqual([]);
    });
});
