/**
 * How much media a session may hold in its demuxer cache, worked out from what
 * the session was really started with. mpv's own defaults (150 MiB ahead,
 * 50 MiB behind) are only the fallback and are marked `assumed`: they are not
 * a guarantee, so the freeze also watches the real growth of the cache while
 * it runs (see split-audio-sync-run.ts).
 */
const MIB = 1024 * 1024;
/** mpv defaults (0.37 and 0.42): demuxer-max-bytes / demuxer-max-back-bytes. */
export const MPV_DEFAULT_MAX_BYTES = 150 * MIB;
export const MPV_DEFAULT_MAX_BACK_BYTES = 50 * MIB;
/** Used when mpv has not measured a bitrate yet: a heavy live HD stream. */
export const FALLBACK_BITRATE_BPS = 12_000_000;

export interface CacheBudget {
    /** Most bytes the cache may hold in this direction; 0 when it is off. */
    bytes: number;
    /** Seconds of media that is, at the stream's bitrate. */
    seconds: number;
    /** True when the number is mpv's default, not something the options set. */
    assumed: boolean;
    /** True when the bitrate was not measured and a fallback was used. */
    bitrateAssumed: boolean;
}

const UNITS: Record<string, number> = {
    '': 1,
    b: 1,
    kib: 1024,
    mib: MIB,
    gib: 1024 * MIB,
    kb: 1000,
    mb: 1_000_000,
    gb: 1_000_000_000,
};

/** `150MiB`, `64M`, `500000` -> bytes; null when it is not a size. */
export function parseByteSize(value: string): number | null {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-z]*)\s*$/i.exec(value);
    if (!match) return null;
    const unit = match[2].toLowerCase().replace(/^([kmg])$/, '$1ib');
    const factor = UNITS[unit];
    return factor === undefined ? null : Math.floor(Number(match[1]) * factor);
}

function lastOption(options: readonly string[], key: string): string | null {
    let found: string | null = null;
    for (const option of options) {
        const at = option.indexOf('=');
        if (at > 0 && option.slice(0, at).trim() === key) {
            found = option.slice(at + 1).trim();
        }
    }
    return found;
}

/**
 * The cache budget of a session started with `options` (`key=value` lines,
 * later lines win) for a stream of `bitrateBps` (null: not measured).
 * `direction` is the part the caller needs: media buffered ahead of the
 * playhead (a freeze) or kept behind it (a jump back).
 */
export function cacheBudget(
    options: readonly string[],
    bitrateBps: number | null,
    direction: 'ahead' | 'back'
): CacheBudget {
    const bitrateAssumed = !bitrateBps || bitrateBps <= 0;
    const bitrate = bitrateAssumed ? FALLBACK_BITRATE_BPS : bitrateBps;
    const bytesPerSecond = bitrate / 8;
    const off = lastOption(options, 'cache') === 'no';
    const key =
        direction === 'ahead' ? 'demuxer-max-bytes' : 'demuxer-max-back-bytes';
    const set = lastOption(options, key);
    const parsed = set === null ? null : parseByteSize(set);
    let bytes =
        parsed ??
        (direction === 'ahead'
            ? MPV_DEFAULT_MAX_BYTES
            : MPV_DEFAULT_MAX_BACK_BYTES);
    let seconds = bytes / bytesPerSecond;
    if (direction === 'ahead') {
        // `cache-secs` caps the read-ahead in time, whatever the bytes allow.
        const capSecs = Number(lastOption(options, 'cache-secs'));
        if (Number.isFinite(capSecs) && capSecs > 0) {
            seconds = Math.min(seconds, capSecs);
        }
    }
    if (off) {
        bytes = 0;
        seconds = 0;
    }
    return {
        bytes,
        seconds,
        assumed: parsed === null && !off,
        bitrateAssumed,
    };
}
