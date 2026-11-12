import type {
    EmbeddedMpvBounds,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { buildEmbeddedMpvPreviewPlan } from './embedded-mpv-preview-session';
import type { NativeEmbeddedMpvAddon } from './embedded-mpv-native.service';

/** Pause between closing a provider connection and opening the next one. */
export const SOUND_REPLACE_SETTLE_MS = 2500;
/** Options of the preview recipe that would silence or starve the sound. */
const SILENCING_OPTIONS =
    /^(ao|aid|mute|demuxer-max-bytes|demuxer-max-back-bytes)=/;

/**
 * The hidden sound session paints only the other channel's match clock (the
 * crop the renderer asked for, a few frames a second), so reading the clock
 * needs no third session. Everything else is the preview recipe, minus what
 * would mute it.
 */
export function soundSessionPlan(playback: ResolvedPortalPlayback): {
    bounds: EmbeddedMpvBounds;
    options: string[];
} {
    const plan = buildEmbeddedMpvPreviewPlan({ region: playback.clockRegion });
    return {
        bounds: plan.bounds,
        options: plan.options.filter(
            (option) => !SILENCING_OPTIONS.test(option)
        ),
    };
}

/** The slice of the raw addon the manager reads and writes directly. */
export interface SplitAudioAddon {
    /** Below the service: the sync freeze must not look like the user's pause. */
    setPaused(sessionId: string, paused: boolean): void;
    seek(sessionId: string, seconds: number): void;
    seekBy?(sessionId: string, deltaSeconds: number): void;
    setSpeed(sessionId: string, speed: number): void;
    setVolume(sessionId: string, volume: number): void;
    getSessionSnapshot(sessionId: string): {
        status: string;
        positionSeconds: number;
        volume: number;
        playbackSpeed?: number;
        stats?: {
            bufferedAheadSeconds?: number;
            droppedFrames?: number;
            videoBitrateBps?: number;
            audioBitrateBps?: number;
        };
    } | null;
}

/** Narrows the raw addon (its speed call is optional) to what the pair needs. */
export function toSplitAudioAddon(
    addon: NativeEmbeddedMpvAddon
): SplitAudioAddon {
    return {
        setPaused: (id, paused) => addon.setPaused(id, paused),
        seek: (id, seconds) => addon.seek(id, seconds),
        seekBy: addon.seekBy
            ? (id, delta) => addon.seekBy?.(id, delta)
            : undefined,
        setSpeed: (id, speed) => addon.setSpeed?.(id, speed),
        setVolume: (id, volume) => addon.setVolume(id, volume),
        getSessionSnapshot: (id) => addon.getSessionSnapshot(id),
    };
}
