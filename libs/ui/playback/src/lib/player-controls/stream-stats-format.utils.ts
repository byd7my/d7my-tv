import { formatBitrate } from './controls-format.utils';
import { positiveOrNull } from './positive-number.util';

/**
 * Pure formatters for the stream-info popover. The rows themselves are put
 * together in `stream-stats-view.ts`; every formatting decision lives here so
 * it is unit-testable in isolation.
 */

/**
 * Ratios worth naming. A raw greatest-common-divisor reduction is exact but
 * unreadable for real streams (1920x816 reduces to 40:17), so a measured ratio
 * snaps to the closest entry here when it is within {@link ASPECT_TOLERANCE}.
 */
const KNOWN_ASPECT_RATIOS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 1, label: '1:1' },
    { value: 5 / 4, label: '5:4' },
    { value: 4 / 3, label: '4:3' },
    { value: 3 / 2, label: '3:2' },
    { value: 16 / 10, label: '16:10' },
    { value: 16 / 9, label: '16:9' },
    { value: 2, label: '2:1' },
    { value: 21 / 9, label: '21:9' },
    { value: 2.35, label: '2.35:1' },
    { value: 2.39, label: '2.39:1' },
    { value: 9 / 16, label: '9:16' },
];

/** Relative distance (1%) at which a measured ratio adopts a known label. */
const ASPECT_TOLERANCE = 0.01;

/** Beyond this, a reduced ratio is less readable than a decimal one. */
const MAX_ASPECT_TERM = 32;

function greatestCommonDivisor(a: number, b: number): number {
    let left = Math.round(a);
    let right = Math.round(b);
    while (right !== 0) {
        [left, right] = [right, left % right];
    }
    return left || 1;
}

export function formatResolution(
    width: number | null,
    height: number | null
): string | null {
    const pixelWidth = positiveOrNull(width);
    const pixelHeight = positiveOrNull(height);
    if (pixelWidth === null || pixelHeight === null) {
        return null;
    }
    return `${Math.round(pixelWidth)} × ${Math.round(pixelHeight)}`;
}

export function formatAspectRatio(
    width: number | null,
    height: number | null
): string | null {
    const pixelWidth = positiveOrNull(width);
    const pixelHeight = positiveOrNull(height);
    if (pixelWidth === null || pixelHeight === null) {
        return null;
    }

    const ratio = pixelWidth / pixelHeight;
    let closest: { label: string; distance: number } | null = null;
    for (const known of KNOWN_ASPECT_RATIOS) {
        const distance = Math.abs(ratio - known.value);
        if (
            distance <= known.value * ASPECT_TOLERANCE &&
            (closest === null || distance < closest.distance)
        ) {
            closest = { label: known.label, distance };
        }
    }
    if (closest) {
        return closest.label;
    }

    const divisor = greatestCommonDivisor(pixelWidth, pixelHeight);
    const reducedWidth = Math.round(pixelWidth) / divisor;
    const reducedHeight = Math.round(pixelHeight) / divisor;
    if (reducedWidth <= MAX_ASPECT_TERM && reducedHeight <= MAX_ASPECT_TERM) {
        return `${reducedWidth}:${reducedHeight}`;
    }
    return `${ratio.toFixed(2)}:1`;
}

/**
 * "50 fps" for broadcast rates, "29.97 fps" for pulled-down ones. The
 * whole-number window is deliberately narrow: 29.97 and 23.976 are meaningful
 * rates in their own right, not measurement noise around 30 and 24.
 */
export function formatFrameRate(fps: number | null): string | null {
    const rate = fps;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
        return null;
    }
    const rounded = Math.round(rate);
    const label =
        Math.abs(rate - rounded) < 0.01 ? `${rounded}` : rate.toFixed(2);
    return `${label} fps`;
}

/**
 * Engine codec ids carry a profile/level suffix (`avc1.640028`, `mp4a.40.2`)
 * that says nothing at a glance; the family alone is what the row is for.
 */
export function formatCodec(codec: string | null): string | null {
    const trimmed = codec?.trim();
    if (!trimmed) {
        return null;
    }
    const [family] = trimmed.split('.');
    return family || trimmed;
}

/** Channel counts people recognise; anything else keeps its raw count. */
const CHANNEL_LAYOUT_LABELS: Readonly<Record<number, string>> = {
    1: 'Mono',
    2: 'Stereo',
    6: '5.1',
    8: '7.1',
};

/**
 * Web engines report a channel *count* (`"6"`), mpv a layout *name*
 * (`"5.1"`, `"stereo"`); both end up as the same label.
 */
export function formatAudioChannels(
    channels: string | number | null
): string | null {
    if (typeof channels === 'number') {
        return formatChannelCount(channels);
    }

    const trimmed = channels?.trim();
    if (!trimmed) {
        return null;
    }
    if (/^\d+$/.test(trimmed)) {
        return formatChannelCount(Number(trimmed));
    }
    const lowercase = trimmed.toLowerCase();
    if (lowercase === 'mono' || lowercase === 'stereo') {
        return lowercase === 'mono' ? 'Mono' : 'Stereo';
    }
    return trimmed;
}

function formatChannelCount(count: number): string | null {
    const channels = positiveOrNull(count);
    if (channels === null) {
        return null;
    }
    const rounded = Math.round(channels);
    return CHANNEL_LAYOUT_LABELS[rounded] ?? `${rounded} ch`;
}

/** "48 kHz", "44.1 kHz" — trailing zeros are noise at this size. */
export function formatSampleRate(hertz: number | null): string | null {
    const rate = positiveOrNull(hertz);
    if (rate === null) {
        return null;
    }
    const label = (rate / 1000).toFixed(2).replace(/\.?0+$/, '');
    return `${label} kHz`;
}

export function formatBufferedSeconds(seconds: number | null): string | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return null;
    }
    return `${Math.max(0, seconds).toFixed(1)} s`;
}

/**
 * "12" alone is meaningless; against a total it becomes a drop rate, which is
 * the number that actually says whether decoding is keeping up.
 */
export function formatDroppedFrames(
    dropped: number | null,
    total: number | null
): string | null {
    if (typeof dropped !== 'number' || !Number.isFinite(dropped)) {
        return null;
    }
    const count = Math.max(0, Math.round(dropped));
    const frameCount = positiveOrNull(total);
    if (frameCount === null) {
        return `${count}`;
    }
    const percent = (count / frameCount) * 100;
    return `${count} (${percent < 0.01 && percent > 0 ? '<0.01' : percent.toFixed(2)}%)`;
}

/** Unlike an encoded bitrate, a transfer of zero is a real reading (a stalled download). */
export function formatNetworkBitrate(
    bitsPerSecond: number | null
): string | null {
    if (typeof bitsPerSecond !== 'number' || !Number.isFinite(bitsPerSecond)) {
        return null;
    }
    return bitsPerSecond <= 0 ? '0 kbps' : formatBitrate(bitsPerSecond);
}
