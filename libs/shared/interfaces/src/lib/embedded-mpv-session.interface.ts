import type { PlayerSubtitleStyle } from './subtitle-style.util';
import type { RecordingStartMetadata } from './recording-metadata.interface';

export type EmbeddedMpvSessionStatus =
    'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error' | 'closed';

export interface EmbeddedMpvBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A rectangle of a video frame, each value 0..1 of the frame's size. */
export interface EmbeddedMpvFrameRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * A second, silent, independent frame-copy session that shows only a region
 * of another channel's picture (the audio-sync window). Without a region it
 * shows the whole frame, which the region picker needs.
 */
export interface EmbeddedMpvPreviewRequest {
    region?: EmbeddedMpvFrameRegion;
    /** Output width in CSS pixels; the height follows the region's shape. */
    outputWidth?: number;
}

/** Pixels copied out of a running frame-copy session. */
export interface EmbeddedMpvFrameCapture {
    width: number;
    height: number;
    /** RGBA, ready for `new ImageData(data, width, height)`. */
    data: Uint8ClampedArray;
    /** Milliseconds since this frame was painted; large means "not live". */
    ageMs: number;
    seq: number;
}

export interface EmbeddedMpvCapabilities {
    subtitles: boolean;
    playbackSpeed: boolean;
    aspectOverride: boolean;
    screenshot: boolean;
    recording: boolean;
    /** Loading an external subtitle file via `sub-add` (frame-copy engine). */
    externalSubtitles?: boolean;
    /** Adjusting `sub-delay` at runtime (frame-copy engine). */
    subtitleDelay?: boolean;
    /** Adjusting `sub-scale`/`sub-color` at runtime (frame-copy engine). */
    subtitleStyle?: boolean;
}

/**
 * Subtitle presentation preferences forwarded to mpv: `sizePercent` maps to
 * `sub-scale` (100 = 1.0); `color` maps to `sub-color`, null restores mpv's
 * default. Alias of the canonical shared shape so the renderer controls and
 * the IPC contract cannot drift structurally.
 */
export type EmbeddedMpvSubtitleStyle = PlayerSubtitleStyle;

export type EmbeddedMpvEngine = 'native' | 'frame-copy';

export interface EmbeddedMpvSupport {
    supported: boolean;
    platform: string;
    reason?: string;
    /**
     * True when `supported: false` is not a verdict on this machine yet: the
     * Linux native-view `mpv` executable was looked up before the login shell
     * PATH arrived, and is looked up again once the shell answers. Never
     * persist a decision made from such an answer; ask again later.
     */
    inconclusive?: boolean;
    capabilities?: EmbeddedMpvCapabilities;
    /**
     * Rendering engine the main process will use for new sessions.
     * `native` = platform video surface (NSOpenGLView/HWND/X11 wid),
     * `frame-copy` = helper process + shm ring + renderer canvas.
     */
    engine?: EmbeddedMpvEngine;
    /**
     * True when this machine could run the frame-copy engine (macOS arm64
     * or Linux x64, after its helper/runtime capability gate), regardless of
     * whether it is active.
     * Drives the Settings toggle; switching engines requires an app restart.
     */
    frameCopyAvailable?: boolean;
    /**
     * Stable fail-closed capability reason when frameCopyAvailable is false.
     * Intended for startup tracing and support diagnostics, not user copy.
     */
    frameCopyUnavailableReason?: string;
}

/**
 * Where the renderer's frame pump finds the current shm frame ring of a
 * frame-copy session. A new generation is announced after every viewport
 * resize; the pump re-attaches to the new segment.
 */
export interface EmbeddedMpvFrameSource {
    shmName: string;
    width: number;
    height: number;
    generation: number;
    readerPath: string;
}

export interface EmbeddedMpvAudioTrack {
    id: number;
    title?: string;
    language?: string;
    selected: boolean;
    defaultTrack?: boolean;
    forced?: boolean;
}

export type EmbeddedMpvSubtitleTrack = EmbeddedMpvAudioTrack;

/** One entry of mpv's `chapter-list`, in file order. */
export interface EmbeddedMpvChapter {
    /** Chapter start, in media seconds. */
    timeSeconds: number;
    title?: string;
}

export interface EmbeddedMpvRecordingState {
    active: boolean;
    targetPath?: string;
    startedAt?: string;
    error?: string;
}

/**
 * Live stream diagnostics mpv reports for the player's info popover. Every
 * field is optional: a property mpv has not answered yet (or an engine that
 * does not observe it) simply omits its row rather than reporting a zero.
 */
export interface EmbeddedMpvStreamStats {
    /** mpv `estimated-vf-fps` — the measured, not the container, rate. */
    fps?: number;
    /** mpv `video-bitrate` / `audio-bitrate`, in bits per second. */
    videoBitrateBps?: number;
    audioBitrateBps?: number;
    /** mpv `video-format` / `audio-codec-name`, e.g. `h264` / `aac`. */
    videoCodec?: string;
    audioCodec?: string;
    /** mpv `audio-params/channels`, e.g. `stereo` or `5.1`. */
    audioChannels?: string;
    /** mpv `audio-params/samplerate`, in Hz. */
    audioSampleRateHz?: number;
    /** mpv `file-format`, e.g. `mpegts` or `hls`. */
    container?: string;
    /** mpv `demuxer-cache-duration`: media buffered ahead, in seconds. */
    bufferedAheadSeconds?: number;
    /** mpv `frame-drop-count` plus `decoder-frame-drop-count`. */
    droppedFrames?: number;
}

export interface EmbeddedMpvRecordingStartOptions {
    directory?: string;
    title?: string;
    /**
     * Channel/EPG snapshot captured by the live host at recording start; the
     * main-process recording tracker persists it. See
     * recording-metadata.interface.ts for why capture must happen up front.
     */
    metadata?: RecordingStartMetadata;
}

export interface EmbeddedMpvSession {
    id: string;
    title: string;
    streamUrl: string;
    status: EmbeddedMpvSessionStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    audioTracks: EmbeddedMpvAudioTrack[];
    selectedAudioTrackId: number | null;
    subtitleTracks: EmbeddedMpvSubtitleTrack[];
    selectedSubtitleTrackId: number | null;
    playbackSpeed: number;
    aspectOverride: string;
    /**
     * The file's chapters (mpv `chapter-list`). Absent from an addon built
     * before chapters were observed and from the Linux `--wid` backend.
     */
    chapters?: EmbeddedMpvChapter[];
    /** Source video size (mpv dwidth/dheight); frame-copy engine only. */
    videoWidth?: number;
    videoHeight?: number;
    /** Live diagnostics for the info popover; absent when mpv reports none. */
    stats?: EmbeddedMpvStreamStats;
    recording?: EmbeddedMpvRecordingState;
    /**
     * Why the audio taken from another channel could not be played. The video
     * is unaffected; absent while the audio works.
     */
    externalAudioError?: string;
    /**
     * Present while the audio taken from another channel is played by a second
     * (hidden) session instead of mpv's audio-add. Absent on the audio-add path.
     */
    splitAudio?: EmbeddedMpvSplitAudioStatus;
    /**
     * The two-session audio mode is switched on for this session: choosing an
     * audio channel creates the hidden sound session (no third session is
     * needed to read the clocks). Absent when the mode is off.
     */
    splitAudioEnabled?: boolean;
    /** Why the external sound was given up (the picture has its own audio back). */
    splitAudioNotice?: EmbeddedMpvSplitAudioNotice;
    startedAt: string;
    updatedAt: string;
    error?: string;
    /**
     * Present while the main process is waiting to reload a dropped stream
     * or has such a reload in flight; absent once playback is back or the
     * attempts are exhausted. Display only — the renderer never schedules.
     */
    reconnect?: EmbeddedMpvReconnectInfo;
}

/** Why the two-session sound ended without the user asking. */
export type EmbeddedMpvSplitAudioNotice =
    'stalled' | 'channel-lost' | 'open-failed';

/** Two-session "audio from another channel": the sync state, for display. */
export interface EmbeddedMpvSplitAudioStatus {
    mode: 'dual-session';
    /** The one decision source: clock readings (auto) or the typed offset (manual). */
    syncMode: 'auto' | 'manual';
    soundSessionId: string;
    state:
        | 'measuring'
        | 'settling'
        | 'synced'
        | 'correcting'
        | 'noisy'
        | 'locked'
        | 'paused'
        | 'off'
        // Auto sync (one run the user starts): see `sync` for the details.
        | 'idle'
        | 'announcing'
        | 'freezing'
        | 'resuming'
        | 'failed';
    /** The speed the user chose, before any sync factor. */
    userSpeed: number;
    /** Speed really sent to the picture / sound session (user x factor). */
    mainSpeed: number;
    soundSpeed: number;
    /** Which session is slowed right now. */
    correcting: 'main' | 'sound' | null;
    /** Slowdown of the corrected session (0.03 = 3 %). */
    rate: number;
    /** Estimated lateness of the sound, seconds (positive: behind). */
    lateness: number | null;
    /** D_base + trim: the lateness the correction aims at. */
    targetSeconds: number;
    dBaseSeconds: number;
    trimSeconds: number;
    /** Measured advance of the sound session per wall second. */
    audioRate: number | null;
    /** Last sound-quality issue seen while slowing, if any. */
    issue: 'stall' | 'starving' | 'rate' | 'drops' | null;
    /** Set when automatic correction gave itself up (the issue that caused it). */
    autoDisabledReason?: string;
    /** Crop of the hidden picture (the other channel's clock); null: whole frame. */
    clockRegion?: EmbeddedMpvFrameRegion | null;
    /** The automatic sync run (auto mode). */
    sync?: EmbeddedMpvSplitAudioSync;
    /**
     * Manual mode: a correction under way was cancelled by a pause, a seek, a
     * reload or a fault. It is NOT applied again until the user says so.
     */
    manualVoided?: 'pause' | 'seek' | 'reload' | 'fault' | null;
    /** The user's choice: the picture's own audio plays while the sound is frozen. */
    originalAudioDuringFreeze?: boolean;
    /** Outcome of the last "quick sync" jump. */
    quickSync?: EmbeddedMpvSplitAudioQuickResult | null;
}

/** The sync buttons of a two-session pair. */
export type SplitAudioSyncAction =
    'start' | 'cancel' | 'quick' | 'original-audio-on' | 'original-audio-off';

export type EmbeddedMpvSplitAudioQuickResult =
    | { kind: 'jumped'; side: 'picture' | 'sound'; seconds: number }
    | { kind: 'nothing' }
    | {
          kind: 'unavailable';
          why: 'no-reading' | 'too-far' | 'no-history' | 'cache';
      };

/** One automatic sync run: measure, one freeze at most, fine correction, done. */
export interface EmbeddedMpvSplitAudioSync {
    phase:
        | 'idle'
        | 'measuring'
        | 'announcing'
        | 'freezing'
        | 'resuming'
        | 'settling'
        | 'fine'
        | 'done'
        | 'failed';
    /** Which side is frozen (or about to be): the one that is ahead. */
    side: 'picture' | 'sound' | null;
    freezeSeconds: number;
    remainingSeconds: number;
    announceSeconds: number;
    /** The gap was bigger than the freeze may be; the rest is gradual. */
    capped: boolean;
    freezeCut:
        | 'cache-insufficient'
        | 'cache-stalled'
        | 'cache-full'
        | 'stream-lost'
        | null;
    failure:
        | 'no-clock'
        | 'unstable'
        | 'timeout'
        | 'interrupted'
        | 'resume-failed'
        | 'faulted'
        | null;
    /** The difference that is left (sound behind: positive), seconds. */
    residualSeconds: number | null;
    /** Grows with every end of a freeze: readers drop their smoothed clocks. */
    epoch: number;
}

/** Progress of the main-process automatic reconnect for one session. */
export interface EmbeddedMpvReconnectInfo {
    /** 1-based number of the attempt that is scheduled or in flight. */
    attempt: number;
    maxAttempts: number;
    /** ISO timestamp at which the scheduled attempt fires. */
    nextAttemptAt: string;
}
