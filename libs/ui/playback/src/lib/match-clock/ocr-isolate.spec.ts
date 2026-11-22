import { isolateClock, otsuThreshold } from './ocr-isolate';

/** A picture of `ink` rectangles on a paper-coloured field, as RGBA. */
function picture(
    width: number,
    height: number,
    paper: number,
    boxes: { x: number; y: number; w: number; h: number; value: number }[]
): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        rgba.fill(paper, i * 4, i * 4 + 3);
        rgba[i * 4 + 3] = 255;
    }
    for (const box of boxes) {
        for (let y = box.y; y < box.y + box.h; y++) {
            for (let x = box.x; x < box.x + box.w; x++) {
                const at = (y * width + x) * 4;
                rgba.fill(box.value, at, at + 3);
            }
        }
    }
    return rgba;
}

/** "12:3" as four tall bars with a two-dot colon between the second and third. */
const clock = (value: number) => [
    { x: 40, y: 20, w: 10, h: 30, value },
    { x: 56, y: 20, w: 10, h: 30, value },
    { x: 72, y: 26, w: 4, h: 4, value },
    { x: 72, y: 40, w: 4, h: 4, value },
    { x: 82, y: 20, w: 10, h: 30, value },
    { x: 98, y: 20, w: 10, h: 30, value },
];

describe('otsuThreshold', () => {
    it('falls between a dark and a light population', () => {
        const values = new Uint8ClampedArray(100).fill(30).fill(220, 50);
        const threshold = otsuThreshold(values);
        expect(threshold).toBeGreaterThanOrEqual(30);
        expect(threshold).toBeLessThan(220);
    });
});

describe('isolateClock', () => {
    it('keeps the clock and drops a big logo shape beside it', () => {
        const logo = { x: 2, y: 5, w: 30, h: 70, value: 20 };
        const rgba = picture(130, 80, 210, [logo, ...clock(20)]);

        const isolated = isolateClock(rgba, 130, 80, 'dark');

        expect(isolated).not.toBeNull();
        // Cropped to the clock (68 wide, 30 tall) plus a margin, not the area.
        expect(isolated?.width).toBeLessThan(100);
        expect(isolated?.height).toBeLessThan(60);
        const inkPixels = isolated?.pixels.filter((p) => p === 0).length;
        // Four bars (300 each) and two dots (16 each).
        expect(inkPixels).toBe(4 * 300 + 2 * 16);
    });

    it('reads light digits on a dark box when asked for light ink', () => {
        const rgba = picture(130, 80, 25, clock(240));

        expect(isolateClock(rgba, 130, 80, 'light')).not.toBeNull();
        expect(isolateClock(rgba, 130, 80, 'dark')).toBeNull();
    });

    it('finds nothing in a picture with no row of characters', () => {
        const rgba = picture(130, 80, 210, [
            { x: 10, y: 10, w: 100, h: 60, value: 20 },
        ]);

        expect(isolateClock(rgba, 130, 80, 'dark')).toBeNull();
    });

    it('finds nothing in an empty picture', () => {
        expect(isolateClock(new Uint8ClampedArray(0), 0, 0, 'dark')).toBeNull();
    });
});
