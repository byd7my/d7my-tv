import type { EmbeddedMpvFrameRegion } from '@iptvnator/shared/interfaces';
import { locateClockBoxes } from './clock-locator';
import { parseMatchClock } from './match-clock.util';

interface FrameImage {
    width: number;
    height: number;
    /** RGBA */
    data: Uint8ClampedArray;
}

export type ClockReader = (
    image: FrameImage
) => Promise<{ text: string; confidence: number }>;

/** The part of an image inside a 0..1 box, as its own image. */
export function cropImage(
    image: FrameImage,
    box: EmbeddedMpvFrameRegion
): FrameImage {
    const x0 = Math.max(0, Math.floor(box.x * image.width));
    const y0 = Math.max(0, Math.floor(box.y * image.height));
    const x1 = Math.min(
        image.width,
        Math.ceil((box.x + box.width) * image.width)
    );
    const y1 = Math.min(
        image.height,
        Math.ceil((box.y + box.height) * image.height)
    );
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, y1 - y0);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const from = ((y0 + y) * image.width + x0) * 4;
        data.set(image.data.subarray(from, from + width * 4), y * width * 4);
    }
    return { width, height, data };
}

/**
 * Looks for the match clock in a whole frame: the places that look like a
 * clock are read one by one, likeliest first, and the first that reads as a
 * real clock is returned as the area to watch (0..1 of the frame).
 */
export async function searchClock(
    image: FrameImage,
    read: ClockReader
): Promise<EmbeddedMpvFrameRegion | null> {
    const boxes = locateClockBoxes(image.data, image.width, image.height);
    for (const box of boxes) {
        const region = {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
        };
        const { text } = await read(cropImage(image, region));
        if (parseMatchClock(text)) return region;
    }
    return null;
}
