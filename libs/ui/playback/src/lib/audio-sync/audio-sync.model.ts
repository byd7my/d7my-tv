import type {
    ElectronBridgeApi,
    ExternalAudioOverride,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { Signal } from '@angular/core';
import type { MatchClockOcrService } from '../match-clock/match-clock-ocr.service';

export type SyncSourceKey = 'main' | 'audio';
export type SyncMode = 'live' | 'pick';
/** `measure` reads the clocks once with a temporary picture; `live` keeps it. */
/**
 * compare: the audio channel's scoreboard stays on screen, the user reads both
 * clocks and sets the difference. measure: reads both clocks once by OCR.
 * live: OCR on a continuous picture (a third connection).
 */
export type ViewMode = 'compare' | 'measure' | 'live';

/**
 * Where the audio channel's picture is cut by default: the top-left corner,
 * where nearly every broadcast puts the scoreboard. It is only a start; the
 * region can be re-picked.
 */
export const DEFAULT_CLOCK_REGION = {
    x: 0,
    y: 0,
    width: 0.45,
    height: 0.16,
} as const;
export type PreviewStatus = 'idle' | 'starting' | 'live' | 'failed';

/** Why a source shows no clock. Maps to a translated message. */
export type SourceProblem =
    | 'unavailable'
    | 'noFrame'
    | 'stale'
    | 'noClock'
    | 'failed'
    /** Measure view: no picture is open, press "measure". */
    | 'idle'
    /** Measure view: the picture was closed after a successful measure. */
    | 'measured';

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
    /** Drops the audio channel's sound (frees its connection), keeps the choice. */
    suspendAudio: () => void;
    /** Plays the chosen audio channel again with its current delay. */
    resumeAudio: () => void;
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
/** Pause before the first automatic measure, so the new sound can start. */
export const AUTO_MEASURE_DELAY_MS = 1500;
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

const VIEW_KEY = 'iptvnator.audioSync.view.v2';

/** Comparing by eye is the default: no reading engine, two connections. */
export function loadViewMode(
    storage: Pick<Storage, 'getItem'> | null
): ViewMode {
    try {
        const saved = storage?.getItem(VIEW_KEY);
        return saved === 'live' || saved === 'measure' ? saved : 'compare';
    } catch {
        return 'compare';
    }
}

export function saveViewMode(
    storage: Pick<Storage, 'setItem'> | null,
    mode: ViewMode
): void {
    try {
        storage?.setItem(VIEW_KEY, mode);
    } catch {
        // not remembered
    }
}
