import {
    cacheBudget,
    FALLBACK_BITRATE_BPS,
    MPV_DEFAULT_MAX_BACK_BYTES,
    MPV_DEFAULT_MAX_BYTES,
    parseByteSize,
} from './split-audio-cache';

describe('parseByteSize', () => {
    it.each([
        ['150MiB', 150 * 1024 * 1024],
        ['64M', 64 * 1024 * 1024],
        ['1GiB', 1024 * 1024 * 1024],
        ['500000', 500000],
        ['2MB', 2_000_000],
    ])('reads %s', (text, bytes) => {
        expect(parseByteSize(text)).toBe(bytes);
    });

    it('refuses what is not a size', () => {
        expect(parseByteSize('lots')).toBeNull();
        expect(parseByteSize('12 parsecs')).toBeNull();
    });
});

describe('cacheBudget', () => {
    const bitrate = 8_000_000; // 1 MB/s

    it('falls back to the mpv default and says it is only assumed', () => {
        const b = cacheBudget([], bitrate, 'ahead');
        expect(b.bytes).toBe(MPV_DEFAULT_MAX_BYTES);
        expect(b.assumed).toBe(true);
        expect(b.seconds).toBeCloseTo(MPV_DEFAULT_MAX_BYTES / 1_000_000, 3);
        expect(cacheBudget([], bitrate, 'back').bytes).toBe(
            MPV_DEFAULT_MAX_BACK_BYTES
        );
    });

    it('takes the limit the session was really started with (last line wins)', () => {
        const b = cacheBudget(
            ['demuxer-max-bytes=100MiB', 'demuxer-max-bytes=20MiB'],
            bitrate,
            'ahead'
        );
        expect(b.bytes).toBe(20 * 1024 * 1024);
        expect(b.assumed).toBe(false);
        expect(b.seconds).toBeCloseTo((20 * 1024 * 1024) / 1_000_000, 3);
    });

    it('caps the time by cache-secs', () => {
        const b = cacheBudget(['cache-secs=12'], bitrate, 'ahead');
        expect(b.seconds).toBe(12);
    });

    it('has no budget when the cache is off', () => {
        const b = cacheBudget(['cache=no'], bitrate, 'ahead');
        expect(b.bytes).toBe(0);
        expect(b.seconds).toBe(0);
    });

    it('uses a heavy fallback bitrate when none was measured', () => {
        const b = cacheBudget([], null, 'ahead');
        expect(b.bitrateAssumed).toBe(true);
        expect(b.seconds).toBeCloseTo(
            (MPV_DEFAULT_MAX_BYTES * 8) / FALLBACK_BITRATE_BPS,
            3
        );
    });
});
