import { normalizeForOcr, ocrScaleFor } from './ocr-preprocess';

function image(pixels: number[][]): Uint8ClampedArray {
    return Uint8ClampedArray.from(
        pixels.flatMap(([r, g, b]) => [r, g, b, 255])
    );
}

describe('normalizeForOcr', () => {
    it('turns white text on a dark box into dark text on white', () => {
        // 8 dark pixels (box) and 2 white (text).
        const dark = [30, 0, 60];
        const input = image([
            dark, dark, dark, dark, dark, dark, dark, dark,
            [255, 255, 255], [255, 255, 255],
        ]);

        const out = normalizeForOcr(input);

        expect(out[0]).toBeGreaterThan(200); // box → light
        expect(out[8 * 4]).toBeLessThan(60); // text → dark
    });

    it('keeps dark text on a light background as it is', () => {
        const light = [240, 240, 240];
        const input = image([
            light, light, light, light, light, light, light, light,
            [10, 10, 10], [10, 10, 10],
        ]);

        const out = normalizeForOcr(input);

        expect(out[0]).toBeGreaterThan(200);
        expect(out[8 * 4]).toBeLessThan(60);
    });

    it('flips the light/dark guess when asked (a light clock box in a dark scoreboard)', () => {
        const dark = [30, 0, 60];
        const input = image([
            dark, dark, dark, dark, dark, dark, dark, dark,
            [255, 255, 255], [255, 255, 255],
        ]);

        const out = normalizeForOcr(input, true);

        expect(out[0]).toBeLessThan(60); // box stays dark
        expect(out[8 * 4]).toBeGreaterThan(200); // text stays light
    });

    it('survives an empty or flat image', () => {
        expect(normalizeForOcr(new Uint8ClampedArray(0))).toHaveLength(0);
        expect(() => normalizeForOcr(image([[9, 9, 9], [9, 9, 9]]))).not.toThrow();
    });
});

describe('ocrScaleFor', () => {
    it('upscales small crops and leaves big ones', () => {
        expect(ocrScaleFor(24)).toBe(3);
        expect(ocrScaleFor(200)).toBe(1);
        expect(ocrScaleFor(4)).toBe(6);
    });
});
