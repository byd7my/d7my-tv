jest.mock('electron', () => ({
    ipcRenderer: {
        invoke: jest.fn(),
        on: jest.fn(),
    },
}));

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    copyStableLatestFrame,
    extractRegion,
    readerPathForRole,
} from './embedded-mpv-frame-pump';

describe('embedded MPV frame pump', () => {
    const frame = new ArrayBuffer(16);

    it('drops a torn copy without consuming its sequence so the next tick retries', () => {
        const reader = {
            latestSeq: jest.fn(() => 7),
            copyLatest: jest
                .fn()
                .mockReturnValueOnce({ seq: 7, ageMs: 1, torn: true })
                .mockReturnValueOnce({ seq: 7, ageMs: 1, torn: false }),
        };

        expect(copyStableLatestFrame(reader, frame, 6)).toBeNull();
        expect(copyStableLatestFrame(reader, frame, 6)).toEqual({
            seq: 7,
            ageMs: 1,
            torn: false,
        });
        expect(reader.copyLatest).toHaveBeenCalledTimes(2);
    });

    it('does not copy when the producer has no newer sequence', () => {
        const reader = {
            latestSeq: jest.fn(() => 6),
            copyLatest: jest.fn(),
        };

        expect(copyStableLatestFrame(reader, frame, 6)).toBeNull();
        expect(reader.copyLatest).not.toHaveBeenCalled();
    });
});

describe('extractRegion', () => {
    // 4x2 frame, BGRA: pixel n has B=n, G=n+100, R=n+200.
    const frame = new Uint8Array(4 * 2 * 4);
    for (let n = 0; n < 8; n++) {
        frame.set([n, n + 100, n + 200, 255], n * 4);
    }

    it('returns the whole frame as RGBA when no region is given', () => {
        const result = extractRegion(frame, 4, 2, undefined, undefined, 5, 9);

        expect(result).toMatchObject({ width: 4, height: 2, ageMs: 5, seq: 9 });
        expect(Array.from(result!.data.slice(0, 4))).toEqual([200, 100, 0, 255]);
    });

    it('crops a normalised region', () => {
        // Right half, bottom row → pixels 6 and 7.
        const result = extractRegion(
            frame,
            4,
            2,
            { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
            undefined,
            0,
            1
        );

        expect(result).toMatchObject({ width: 2, height: 1 });
        expect(Array.from(result!.data)).toEqual([
            206, 106, 6, 255, 207, 107, 7, 255,
        ]);
    });

    it('decimates a frame wider than maxWidth', () => {
        const result = extractRegion(frame, 4, 2, undefined, 2, 0, 1);

        expect(result).toMatchObject({ width: 2, height: 1 });
    });
});

describe('readerPathForRole', () => {
    const original = join(mkdtempSync(join(tmpdir(), 'reader-spec-')), 'r.node');
    writeFileSync(original, 'addon');

    it('lets the main picture use the shipped file itself', () => {
        expect(readerPathForRole('main', original)).toBe(original);
    });

    it('gives the preview its own copy so the two never share a frame ring', () => {
        const copy = readerPathForRole('preview', original);
        expect(copy).not.toBe(original);
        expect(readFileSync(copy, 'utf8')).toBe('addon');
        // Asking again reuses the copy (a loaded library cannot be rewritten).
        expect(readerPathForRole('preview', original)).toBe(copy);
    });
});
