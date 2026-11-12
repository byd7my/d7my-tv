import { SYNC_CONFIG } from './split-audio-sync-config';

export function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface StableWindow {
    median: number;
    inliers: number[];
}

/**
 * The window of readings is stable when enough of them agree: few outliers
 * (a glitch among steady readings does not count), and the ones that agree
 * lie within a narrow spread. Null: not stable (yet).
 */
export function stableWindow(values: number[]): StableWindow | null {
    if (values.length < SYNC_CONFIG.minReadings) return null;
    const med = median(values);
    const inliers = values.filter(
        (v) => Math.abs(v - med) <= SYNC_CONFIG.inlierBand
    );
    if (
        values.length - inliers.length >
        values.length * SYNC_CONFIG.maxOutlierShare
    ) {
        return null;
    }
    if (inliers.length < SYNC_CONFIG.minReadings - 1) return null;
    if (Math.max(...inliers) - Math.min(...inliers) > SYNC_CONFIG.maxSpread) {
        return null;
    }
    return { median: med, inliers };
}
