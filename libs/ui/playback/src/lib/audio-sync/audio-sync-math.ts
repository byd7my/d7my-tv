/**
 * Maths of the audio-sync window.
 *
 * `offset` = audio channel's match clock − main video's match clock, read at
 * the same moment. A positive offset means the audio channel is ahead of the
 * picture, so its sound arrives early and has to be delayed.
 *
 * The audio in use is already shifted by `delay` seconds (mpv's audio-delay,
 * positive = later), so what is still out of step is `offset − delay`. The
 * offset does not depend on the delay, so it stays put while the user adjusts.
 */

/** Differences at or below this many seconds count as in sync. */
export const IN_SYNC_TOLERANCE_SECONDS = 0.75;
/** Number of recent offsets the median is taken over. */
const SMOOTHING_WINDOW = 9;
const MIN_SAMPLES = 3;

export type SyncDirection = 'inSync' | 'delayAudio' | 'advanceAudio';

export interface SyncSuggestion {
    direction: SyncDirection;
    /** Seconds to move the delay by (always ≥ 0). */
    seconds: number;
    /** Delay that would remove the remaining difference. */
    targetDelay: number;
}

export function roundTo(value: number, step: number): number {
    return Math.round(value / step) * step;
}

/** What is still out of step with the current delay applied. */
export function residualSeconds(offset: number, delay: number): number {
    return offset - delay;
}

export function suggestCorrection(
    offset: number,
    delay: number,
    clampDelay: (value: number) => number = (value) => value
): SyncSuggestion {
    const residual = residualSeconds(offset, delay);
    const targetDelay = clampDelay(roundTo(offset, 0.5));
    if (Math.abs(residual) <= IN_SYNC_TOLERANCE_SECONDS) {
        return { direction: 'inSync', seconds: 0, targetDelay: delay };
    }
    return {
        direction: residual > 0 ? 'delayAudio' : 'advanceAudio',
        seconds: Math.abs(roundTo(residual, 0.5)),
        targetDelay,
    };
}

/** Median of the latest offsets, so one misread clock never moves the figure. */
export class OffsetSmoother {
    private values: number[] = [];

    push(value: number): void {
        this.values.push(value);
        if (this.values.length > SMOOTHING_WINDOW) this.values.shift();
    }

    clear(): void {
        this.values = [];
    }

    /** Null until enough samples agree to say anything. */
    get median(): number | null {
        if (this.values.length < MIN_SAMPLES) return null;
        const sorted = [...this.values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    get size(): number {
        return this.values.length;
    }
}
