import type { EmbeddedMpvFrameRegion } from '@iptvnator/shared/interfaces';

/**
 * Where the scoreboard clock sits in each channel's picture. Every channel
 * has its own broadcaster graphics, so the region is remembered per channel
 * (by stream URL) and picked once.
 */

const STORAGE_KEY = 'iptvnator.audioSync.regions.v1';
const MAX_ENTRIES = 60;
const MIN_EDGE = 0.02;

export type AudioSyncRegions = Record<string, EmbeddedMpvFrameRegion>;

export function normalizeRegion(
    region: EmbeddedMpvFrameRegion
): EmbeddedMpvFrameRegion | null {
    const values = [region.x, region.y, region.width, region.height];
    if (!values.every((value) => Number.isFinite(value))) return null;
    const width = Math.min(1, region.width);
    const height = Math.min(1, region.height);
    if (width < MIN_EDGE || height < MIN_EDGE) return null;
    return {
        x: Math.min(1 - width, Math.max(0, region.x)),
        y: Math.min(1 - height, Math.max(0, region.y)),
        width,
        height,
    };
}

/** A drag from one point to another, in 0..1 of the frame, as a region. */
export function regionFromDrag(
    start: { x: number; y: number },
    end: { x: number; y: number }
): EmbeddedMpvFrameRegion | null {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const x1 = clamp(Math.min(start.x, end.x));
    const y1 = clamp(Math.min(start.y, end.y));
    const x2 = clamp(Math.max(start.x, end.x));
    const y2 = clamp(Math.max(start.y, end.y));
    return normalizeRegion({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

export function loadRegions(storage: Pick<Storage, 'getItem'>): AudioSyncRegions {
    try {
        const raw = storage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object') return {};
        const result: AudioSyncRegions = {};
        for (const [key, value] of Object.entries(parsed)) {
            const region = normalizeRegion(value as EmbeddedMpvFrameRegion);
            if (region) result[key] = region;
        }
        return result;
    } catch {
        return {};
    }
}

export function saveRegion(
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    url: string,
    region: EmbeddedMpvFrameRegion
): void {
    try {
        const all = loadRegions(storage);
        // Re-inserting moves the entry to the end, so the oldest are dropped.
        delete all[url];
        all[url] = region;
        const keys = Object.keys(all);
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
            delete all[key];
        }
        storage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Storage can be unavailable; the region is just picked again.
    }
}

export function forgetRegion(
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    url: string
): void {
    try {
        const all = loadRegions(storage);
        delete all[url];
        storage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // see saveRegion
    }
}
