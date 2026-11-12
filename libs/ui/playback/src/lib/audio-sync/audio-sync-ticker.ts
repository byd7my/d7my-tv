import type {
    EmbeddedMpvFrameCapture,
    EmbeddedMpvFrameRegion,
} from '@iptvnator/shared/interfaces';
import type { AudioSyncCompare } from './audio-sync-compare';
import type { AudioSyncReadings } from './audio-sync-readings';
import type { AudioSyncSplit } from './audio-sync-split';
import {
    FIRST_FRAME_TIMEOUT_MS,
    MAIN_CAPTURE_WIDTH,
    OCR_EVERY,
    PICK_CAPTURE_WIDTH,
    TICK_MS,
    type PreviewStatus,
    type SyncApi,
    type SyncMode,
    type SyncSourceKey,
    type ViewMode,
} from './audio-sync.model';

/** What the capture loop reads from the controller (signals are called, not owned). */
export interface AudioSyncTickContext {
    api: () => Partial<SyncApi> | undefined;
    mode: () => SyncMode;
    pickSource: () => SyncSourceKey;
    viewMode: () => ViewMode;
    mainRegion: () => EmbeddedMpvFrameRegion | null;
    previewStatus: () => PreviewStatus;
    setPreviewLive: () => void;
    previewStartedAt: () => number;
    now: () => number;
    readings: AudioSyncReadings;
    compare: AudioSyncCompare;
    split: AudioSyncSplit;
    offset: () => number | null;
    pickFrame: (frame: EmbeddedMpvFrameCapture | null) => void;
    mainFrame: (frame: EmbeddedMpvFrameCapture | null) => void;
    failPreview: () => void;
}

/**
 * The capture loop of the sync reader: every tick it grabs the frames, every
 * `OCR_EVERY` ticks it reads the clocks and hands the offset to the sound
 * correction. It runs for as long as the controller wants readings, with or
 * without the window on screen.
 */
export class AudioSyncTicker {
    private timer: ReturnType<typeof setInterval> | null = null;
    private ticks = 0;

    constructor(private readonly ctx: AudioSyncTickContext) {}

    start(): void {
        this.stop();
        this.ticks = 0;
        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    stop(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }

    private tick(): void {
        const { ctx } = this;
        const api = ctx.api();
        if (!api?.captureEmbeddedMpvFrame) return;

        if (ctx.mode() === 'pick') {
            // Two-session audio: the picker shows the hidden sound session's
            // whole picture, which is reopened uncropped for it; it has to be
            // attached here too, and there is no preview session whose
            // "playing" update would end the "opening" state.
            ctx.split.sync();
            if (ctx.pickSource() === 'main') {
                ctx.pickFrame(
                    api.captureEmbeddedMpvFrame(
                        'main',
                        undefined,
                        PICK_CAPTURE_WIDTH
                    )
                );
            } else if (ctx.split.active && ctx.previewStatus() === 'starting') {
                this.checkFirstFrame(api.captureEmbeddedMpvFrame('preview'));
            }
            return;
        }

        ctx.split.sync();
        if (ctx.viewMode() === 'compare') {
            // Nothing to read: the user compares the two clocks by eye.
            ctx.split.reportCompared(ctx.compare.offset());
            this.checkFirstFrame(api.captureEmbeddedMpvFrame('preview'));
            return;
        }

        const mainRegion = ctx.mainRegion();
        const mainFrame =
            mainRegion &&
            api.captureEmbeddedMpvFrame('main', mainRegion, MAIN_CAPTURE_WIDTH);
        const audioFrame = api.captureEmbeddedMpvFrame('preview');
        ctx.mainFrame(
            mainFrame && ctx.readings.isFresh(mainFrame) ? mainFrame : null
        );

        if (++this.ticks % OCR_EVERY === 0 && !ctx.readings.busy) {
            void ctx.readings.readClocks(mainFrame, audioFrame);
        }
        ctx.readings.refresh(mainFrame, audioFrame);
        if (this.ticks % OCR_EVERY === 0) ctx.split.reportRead(ctx.offset());
        this.checkFirstFrame(audioFrame);
    }

    private checkFirstFrame(audioFrame: EmbeddedMpvFrameCapture | null): void {
        const { ctx } = this;
        if (ctx.previewStatus() !== 'starting') return;
        if (audioFrame) ctx.setPreviewLive();
        else if (ctx.now() - ctx.previewStartedAt() > FIRST_FRAME_TIMEOUT_MS) {
            ctx.failPreview();
        }
    }
}
