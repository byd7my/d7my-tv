import { computed, effect, signal, untracked } from '@angular/core';
import type {
    EmbeddedMpvFrameCapture,
    EmbeddedMpvFrameRegion,
} from '@iptvnator/shared/interfaces';
import {
    formatMatchClock,
    MatchClockTracker,
    parseManualClock,
    parseMatchClock,
} from '../match-clock/match-clock.util';
import { OffsetSmoother, residualSeconds, suggestCorrection } from './audio-sync-math';
import {
    forgetRegion,
    loadRegions,
    saveRegion,
} from './audio-sync-regions';
import { AudioSyncPreview } from './audio-sync-preview';
import {
    AudioSyncOptions,
    EMPTY_READOUT,
    FIRST_FRAME_TIMEOUT_MS,
    MAIN_CAPTURE_WIDTH,
    NO_STORAGE,
    OCR_EVERY,
    PICK_CAPTURE_WIDTH,
    PreviewStatus,
    safeLocalStorage,
    sameReadout,
    SourceProblem,
    SourceReadout,
    STALE_AFTER_MS,
    SyncMode,
    SyncSourceKey,
    TICK_MS,
} from './audio-sync.model';

export type {
    AudioSyncOptions,
    PreviewStatus,
    SourceProblem,
    SourceReadout,
    SyncMode,
    SyncSourceKey,
} from './audio-sync.model';

/**
 * Drives the audio-sync window. It runs a silent second session on the audio
 * channel (cropped to its scoreboard) next to the untouched main session,
 * reads the match clock from both pictures, and turns the difference into a
 * suggestion for the audio delay. Nothing here touches the main session.
 */
export class AudioSyncController {
    readonly isOpen = signal(false);
    readonly mode = signal<SyncMode>('live');
    /** Which picture the region picker is on. */
    readonly pickSource = signal<SyncSourceKey>('audio');
    readonly previewStatus = signal<PreviewStatus>('idle');
    readonly ocrFailed = signal(false);

    readonly mainRegion = signal<EmbeddedMpvFrameRegion | null>(null);
    readonly audioRegion = signal<EmbeddedMpvFrameRegion | null>(null);

    readonly main = signal<SourceReadout>(EMPTY_READOUT, { equal: sameReadout });
    readonly audioReadout = signal<SourceReadout>(EMPTY_READOUT, {
        equal: sameReadout,
    });

    /** Audio channel clock minus main clock, smoothed; null until stable. */
    readonly offset = signal<number | null>(null);
    readonly delay = computed(() => this.options.audio()?.delaySeconds ?? 0);
    readonly residual = computed(() => {
        const offset = this.offset();
        return offset === null ? null : residualSeconds(offset, this.delay());
    });
    readonly suggestion = computed(() => {
        const offset = this.offset();
        return offset === null
            ? null
            : suggestCorrection(offset, this.delay(), this.options.clampDelay);
    });

    /** Receives the cropped main-clock picture each tick (drawn by the view). */
    mainFrameListener: ((frame: EmbeddedMpvFrameCapture | null) => void) | null =
        null;
    /** Receives a full main frame while the region picker is on `main`. */
    pickFrameListener: ((frame: EmbeddedMpvFrameCapture | null) => void) | null =
        null;

    private timer: ReturnType<typeof setInterval> | null = null;
    private ticks = 0;
    private ocrBusy = false;
    /** Bumped by open/close/restart; stale async work checks it. */
    private epoch = 0;
    private previewStartedAt = 0;
    private readonly trackers: Record<SyncSourceKey, MatchClockTracker> = {
        main: new MatchClockTracker(),
        audio: new MatchClockTracker(),
    };
    private readonly smoother = new OffsetSmoother();
    private readonly preview = new AudioSyncPreview({
        api: () => this.options.api(),
        audio: () => this.options.audio(),
        toPlayback: (audio) => this.options.toPlayback(audio),
        onPlaying: () => this.previewStatus.set('live'),
        onFailed: () => this.failPreview(),
    });
    private readonly now: () => number;
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

    constructor(private readonly options: AudioSyncOptions) {
        this.now = options.now ?? (() => performance.now());
        this.storage =
            options.storage === undefined
                ? safeLocalStorage()
                : options.storage;

        // A different audio channel needs its own picture and region.
        let lastUrl: string | null = null;
        effect(() => {
            const url = this.options.audio()?.streamUrl ?? null;
            untracked(() => {
                if (url === lastUrl) return;
                lastUrl = url;
                if (!this.isOpen()) return;
                if (url) void this.begin();
                else this.close();
            });
        });
    }

    /**
     * The clock window needs the frame-copy engine (Windows): only it paints
     * the picture into the page, where it can be read. Not a signal on
     * purpose: the player's canvas appears after this object exists.
     */
    available(): boolean {
        const api = this.options.api();
        return (
            !!api?.createEmbeddedMpvPreviewSession &&
            !!api.captureEmbeddedMpvFrame &&
            !!api.attachEmbeddedMpvFrameView &&
            !!api.loadEmbeddedMpvPlayback &&
            typeof document !== 'undefined' &&
            document.querySelector('canvas[data-embedded-mpv-frame]') !== null
        );
    }

    /** True once the picker has regions for both pictures. */
    readonly hasRegions = computed(
        () => this.mainRegion() !== null && this.audioRegion() !== null
    );

    open(): void {
        if (this.isOpen()) return;
        this.isOpen.set(true);
        void this.begin();
    }

    close(): void {
        if (!this.isOpen()) return;
        this.isOpen.set(false);
        this.epoch++;
        this.preview.cancel();
        this.stopTimer();
        void this.stopPreview();
        this.resetReadings();
        this.previewStatus.set('idle');
        void this.options.ocr.dispose();
    }

    toggle(): void {
        if (this.isOpen()) this.close();
        else this.open();
    }

    /** Back to picking the scoreboard region(s). */
    startPicking(source: SyncSourceKey = 'audio'): void {
        if (!this.isOpen()) return;
        this.mode.set('pick');
        this.pickSource.set(source);
        this.resetReadings();
        void this.startPreview(null);
        this.startTimer();
    }

    selectPickSource(source: SyncSourceKey): void {
        this.pickSource.set(source);
    }

    /** Stores the region the user dragged for the source being picked. */
    confirmRegion(region: EmbeddedMpvFrameRegion): void {
        const source = this.pickSource();
        const url = this.keyFor(source);
        if (url) saveRegion(this.storage ?? NO_STORAGE, url, region);
        (source === 'main' ? this.mainRegion : this.audioRegion).set(region);

        // The other picture still needs a region.
        if (source === 'audio' && !this.mainRegion()) {
            this.pickSource.set('main');
            return;
        }
        if (source === 'main' && !this.audioRegion()) {
            this.pickSource.set('audio');
            return;
        }
        this.mode.set('live');
        void this.startPreview(this.audioRegion());
    }

    forgetRegions(): void {
        for (const source of ['main', 'audio'] as const) {
            const url = this.keyFor(source);
            if (url) forgetRegion(this.storage ?? NO_STORAGE, url);
            (source === 'main' ? this.mainRegion : this.audioRegion).set(null);
        }
        this.startPicking('audio');
    }

    /** The user types the real clock of a source; OCR re-confirms it later. */
    setManualClock(source: SyncSourceKey, text: string): boolean {
        const seconds = parseManualClock(text);
        if (seconds === null) return false;
        this.trackers[source].setManual(seconds, this.now());
        this.smoother.clear();
        this.refreshReadouts();
        return true;
    }

    applySuggestion(): void {
        const suggestion = this.suggestion();
        if (!suggestion || suggestion.direction === 'inSync') return;
        this.options.setDelay(suggestion.targetDelay);
    }

    // ---------------------------------------------------------------- start

    private async begin(): Promise<void> {
        const epoch = ++this.epoch;
        this.resetReadings();
        const audio = this.options.audio();
        if (!audio) return;

        const regions = this.storage ? loadRegions(this.storage) : {};
        this.mainRegion.set(regions[this.options.videoUrl()] ?? null);
        this.audioRegion.set(regions[audio.streamUrl] ?? null);

        if (!this.available()) {
            this.previewStatus.set('failed');
            this.audioReadout.set({ ...EMPTY_READOUT, problem: 'unavailable' });
            return;
        }

        if (!this.audioRegion() || !this.mainRegion()) {
            this.mode.set('pick');
            this.pickSource.set(this.audioRegion() ? 'main' : 'audio');
            await this.startPreview(null);
        } else {
            this.mode.set('live');
            await this.startPreview(this.audioRegion());
        }
        if (epoch === this.epoch) this.startTimer();
    }

    private async startPreview(
        region: EmbeddedMpvFrameRegion | null
    ): Promise<void> {
        this.previewStatus.set('starting');
        this.previewStartedAt = this.now();
        this.audioReadout.set({ ...EMPTY_READOUT, problem: 'noFrame' });
        await this.preview.start(region);
    }

    private stopPreview(): Promise<void> {
        return this.preview.stop();
    }

    private failPreview(): void {
        this.previewStatus.set('failed');
        this.audioReadout.set({ ...EMPTY_READOUT, problem: 'failed' });
        this.trackers.audio.reset();
        this.smoother.clear();
        this.offset.set(null);
    }

    // ----------------------------------------------------------------- tick

    private startTimer(): void {
        this.stopTimer();
        this.ticks = 0;
        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    private stopTimer(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }

    private tick(): void {
        const api = this.options.api();
        if (!api?.captureEmbeddedMpvFrame) return;

        if (this.mode() === 'pick') {
            if (this.pickSource() === 'main') {
                this.pickFrameListener?.(
                    api.captureEmbeddedMpvFrame('main', undefined, PICK_CAPTURE_WIDTH)
                );
            }
            return;
        }

        const mainRegion = this.mainRegion();
        const mainFrame = mainRegion
            ? api.captureEmbeddedMpvFrame('main', mainRegion, MAIN_CAPTURE_WIDTH)
            : null;
        const audioFrame = api.captureEmbeddedMpvFrame('preview');
        this.mainFrameListener?.(mainFrame && this.isFresh(mainFrame) ? mainFrame : null);

        if (++this.ticks % OCR_EVERY === 0 && !this.ocrBusy) {
            void this.readClocks(mainFrame, audioFrame);
        }
        this.refreshReadouts(mainFrame, audioFrame);
        this.checkFirstFrameTimeout(audioFrame);
    }

    private isFresh(frame: EmbeddedMpvFrameCapture | null): boolean {
        return frame !== null && frame.ageMs <= STALE_AFTER_MS;
    }

    private checkFirstFrameTimeout(audioFrame: EmbeddedMpvFrameCapture | null): void {
        if (
            this.previewStatus() === 'starting' &&
            audioFrame === null &&
            this.now() - this.previewStartedAt > FIRST_FRAME_TIMEOUT_MS
        ) {
            this.failPreview();
        } else if (audioFrame && this.previewStatus() === 'starting') {
            this.previewStatus.set('live');
        }
    }

    private async readClocks(
        mainFrame: EmbeddedMpvFrameCapture | null,
        audioFrame: EmbeddedMpvFrameCapture | null
    ): Promise<void> {
        this.ocrBusy = true;
        const epoch = this.epoch;
        try {
            const frames: Array<[SyncSourceKey, EmbeddedMpvFrameCapture | null]> = [
                ['main', mainFrame],
                ['audio', audioFrame],
            ];
            for (const [source, frame] of frames) {
                if (!this.isFresh(frame)) {
                    this.trackers[source].reset();
                    continue;
                }
                const reading = await this.options.ocr.recognize(frame as EmbeddedMpvFrameCapture);
                if (epoch !== this.epoch) return;
                this.trackers[source].ingest(
                    parseMatchClock(reading.text),
                    reading.confidence,
                    this.now()
                );
            }
            this.ocrFailed.set(false);
            this.updateOffset();
        } catch (error) {
            console.error('[audio-sync] OCR failed:', error);
            this.ocrFailed.set(true);
        } finally {
            this.ocrBusy = false;
        }
    }

    private updateOffset(): void {
        const now = this.now();
        const main = this.trackers.main.currentSeconds(now);
        const audio = this.trackers.audio.currentSeconds(now);
        if (main === null || audio === null) {
            this.smoother.clear();
            this.offset.set(null);
            return;
        }
        this.smoother.push(audio - main);
        this.offset.set(this.smoother.median);
    }

    private refreshReadouts(
        mainFrame?: EmbeddedMpvFrameCapture | null,
        audioFrame?: EmbeddedMpvFrameCapture | null
    ): void {
        const now = this.now();
        const sources: Array<
            [SyncSourceKey, EmbeddedMpvFrameCapture | null | undefined]
        > = [
            ['main', mainFrame],
            ['audio', audioFrame],
        ];
        for (const [source, frame] of sources) {
            const target = source === 'main' ? this.main : this.audioReadout;
            if (source === 'audio' && this.previewStatus() === 'failed') {
                continue;
            }
            const snapshot = this.trackers[source].snapshot(now);
            let problem: SourceProblem | null = null;
            if (frame === undefined) {
                // Called from setManualClock: keep the liveness we know.
                problem = target().problem;
            } else if (frame === null) {
                problem = 'noFrame';
            } else if (!this.isFresh(frame)) {
                problem = 'stale';
            } else if (!snapshot) {
                problem = 'noClock';
            }
            target.set({
                text:
                    problem === null || problem === 'noClock'
                        ? snapshot
                            ? formatMatchClock(snapshot.seconds)
                            : null
                        : null,
                confidence: snapshot?.confidence ?? 0,
                live: problem === null,
                problem,
                manual: snapshot?.manual ?? false,
            });
        }
        if (!this.main().live || !this.audioReadout().live) {
            this.offset.set(null);
        }
    }

    private resetReadings(): void {
        this.trackers.main.reset();
        this.trackers.audio.reset();
        this.smoother.clear();
        this.offset.set(null);
        this.main.set(EMPTY_READOUT);
        this.audioReadout.set(EMPTY_READOUT);
        this.ocrFailed.set(false);
    }

    private keyFor(source: SyncSourceKey): string {
        return source === 'main'
            ? this.options.videoUrl()
            : (this.options.audio()?.streamUrl ?? '');
    }
}
