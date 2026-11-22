import { cropImage, searchClock } from './clock-search';

const W = 400;
const H = 200;

function scoreboard(): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(W * H * 4).fill(110);
    const rect = (x: number, y: number, w: number, h: number, v: number) => {
        for (let j = y; j < y + h; j++) {
            for (let i = x; i < x + w; i++) {
                const at = (j * W + i) * 4;
                rgba[at] = rgba[at + 1] = rgba[at + 2] = v;
            }
        }
    };
    rect(40, 30, 140, 50, 25);
    for (const dx of [0, 14, 56, 70]) rect(60 + dx, 42, 9, 24, 245);
    rect(96, 47, 5, 5, 245);
    rect(96, 57, 5, 5, 245);
    return rgba;
}

describe('cropImage', () => {
    it('cuts the box out of the picture', () => {
        const image = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
        for (let i = 0; i < 16; i++) image.data[i * 4] = i;

        const crop = cropImage(image, {
            x: 0.5,
            y: 0.5,
            width: 0.5,
            height: 0.5,
        });

        expect(crop.width).toBe(2);
        expect(crop.height).toBe(2);
        expect(Array.from(crop.data).filter((_, i) => i % 4 === 0)).toEqual([
            10, 11, 14, 15,
        ]);
    });
});

describe('searchClock', () => {
    const image = { width: W, height: H, data: scoreboard() };

    it('returns the area of the first place that reads as a clock', async () => {
        const read = jest
            .fn()
            .mockResolvedValue({ text: '63:08', confidence: 80 });

        const region = await searchClock(image, read);

        expect(region).not.toBeNull();
        expect(region!.x * W).toBeLessThanOrEqual(60);
        expect(read).toHaveBeenCalledTimes(1);
        // What is read is the cut-out, not the whole frame.
        expect(read.mock.calls[0][0].width).toBeLessThan(W);
    });

    it('gives up when nothing that looks like a clock reads as one', async () => {
        const read = jest
            .fn()
            .mockResolvedValue({ text: '3-1', confidence: 0 });

        expect(await searchClock(image, read)).toBeNull();
    });
});
