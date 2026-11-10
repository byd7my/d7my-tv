import type {
    ElectronBridgeApi,
    ExternalAudioOverride,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { Signal } from '@angular/core';
import type { MatchClockOcrService } from '../match-clock/match-clock-ocr.service';

export type SyncSourceKey = 'main' | 'audio';
export type SyncMode = 'live' | 'pick';
export type PreviewStatus = 'idle' | 'starting' | 'live' | 'failed';

/** Why a source shows no clock. Maps to a translated message. */
export type SourceProblem =
    | 'unavailable'
    | 'noFrame'
    | 'stale'
    | 'noClock'
    | 'failed';

export interface SourceReadout {
    /** Clock as read from the picture, e.g. "87:43"; null when none. */
    text: string | null;
    confidence: number;
    /** True while fresh frames arrive; a frozen picture is never "live". */
    live: boolean;
    problem: SourceProblem | null;
    /** The clock was typed by the user rather than read. */
    manual: boolean;
}

export const EMPTY_READOUT: SourceReadout = {
    text: null,
    confidence: 0,
    live: false,
    problem: 'noFrame',
    manual: false,
};

export type SyncApi = Pick<
    ElectronBridgeApi,
    | 'createEmbeddedMpvPreviewSession'
    | 'attachEmbeddedMpvFrameView'
    | 'detachEmbeddedMpvFrameView'
    | 'captureEmbeddedMpvFrame'
    | 'loadEmbeddedMpvPlayback'
    | 'disposeEmbeddedMpvSession'
    | 'onEmbeddedMpvSessionUpdate'
>;

export interface AudioSyncOptions {
    api: () => Partial<SyncApi> | undefined;
    audio: Signal<ExternalAudioOverride | null>;
    videoUrl: Signal<string>;
    setDelay: (seconds: number) => void;
    clampDelay: (seconds: number) => number;
    toPlayback: (audio: ExternalAudioOverride) => ResolvedPortalPlayback;
    ocr: Pick<MatchClockOcrService, 'recognize' | 'dispose'>;
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    now?: () => number;
}

/** Capture cadence; the clock is read every `OCR_EVERY` ticks (once a second). */
export const TICK_MS = 250;
export const OCR_EVERY = 4;
/** A picture older than this is not a live picture. */
export const STALE_AFTER_MS = 3000;
/** Wait this long for the first frame before calling the preview failed. */
export const FIRST_FRAME_TIMEOUT_MS = 20000;
export const PREVIEW_WIDTH = 480;
export const PICK_CAPTURE_WIDTH = 640;
export const MAIN_CAPTURE_WIDTH = 480;

export function sameReadout(a: SourceReadout, b: SourceReadout): boolean {
    return (
        a.text === b.text &&
        a.live === b.live &&
        a.problem === b.problem &&
        a.manual === b.manual &&
        Math.round(a.confidence / 5) === Math.round(b.confidence / 5)
    );
}

export const NO_STORAGE: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: () => null,
    setItem: () => undefined,
};

export function safeLocalStorage(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}
