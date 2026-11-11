import { computed, effect, signal, untracked, WritableSignal } from '@angular/core';
import type {
    EmbeddedMpvFrameCapture,
    EmbeddedMpvFrameRegion,
} from '@iptvnator/shared/interfaces';
import { parseManualClock } from '../match-clock/match-clock.util';
import { OffsetSmoother, residualSeconds, suggestCorrection } from './audio-sync-math';
import { loadRegions, saveRegion } from './audio-sync-regions';
import { AudioSyncReadings } from './audio-sync-readings';
import { AudioSyncCompare } from './audio-sync-compare';
import { AudioSyncMeasure } from './audio-sync-measure';
import { AudioSyncPreview } from './audio-sync-preview';
import { AudioSyncSlot } from './audio-sync-slot';
import {
    AudioSyncOptions,
    loadViewMode,
    saveViewMode,
    EMPTY_READOUT,
    AUTO_MEASURE_DELAY_MS,
    DEFAULT_CLOCK_REGION,
    FIRST_FRAME_TIMEOUT_MS,
    MAIN_CAPTURE_WIDTH,
    NO_STORAGE,
    OCR_EVERY,
    PICK_CAPTURE_WIDTH,
    PreviewStatus,
    safeLocalStorage,
    SourceReadout,
    SyncMode,
    SyncSourceKey,
    TICK_MS,
    ViewMode,
} from './audio-sync.model';

export type {
    AudioSyncOptions,
    PreviewStatus,
    SourceProblem,
    SourceReadout,
    SyncMode,
    SyncSourceKey,
    ViewMode,
} from './audio-sync.model';

/**
 * Drives the audio-sync window. It runs a silent second session on the audio
 * channel (cropped to its scoreboard) next to the untouched main session,
 * reads the match clock from both pictures, and turns the difference into a
 * suggestion for the audio delay. Nothing here touches the main session.
 */
export class AudioSyncController {
    private readonly readings: AudioSyncReadings = new AudioSyncReadings({
        now: () => this.now(),
        recognize: (frame) => this.options.ocr.recognize(frame),
        epoch: () => this.epoch,
        previewFailed: () => this.previewStatus() === 'failed',
        audioSideIdle: (): boolean =>
            this.viewMode() === 'measure' && !this.measure.running(),
    });
    readonly isOpen = signal(false);
    readonly mode = signal<SyncMode>('live');
    /** Which picture the region picker is on. */
    readonly pickSource = signal<SyncSourceKey>('audio');
    readonly previewStatus = signal<PreviewStatus>('idle');
    readonly ocrFailed = this.readings.ocrFailed;
    /** Compare by eye, measure once, or keep a live picture (three connections). */
    readonly viewMode = signal<ViewMode>('compare');
    /** Compare view: the clocks the user read off the two pictures. */
    readonly compare = new AudioSyncCompare();
    readonly pictureClockText = this.compare.pictureText;
    readonly audioClockText = this.compare.audioText;
    /** The live picture failed, so the window switched to measuring. */
    readonly fallbackNotice = signal(false);

    readonly mainRegion = signal<EmbeddedMpvFrameRegion | null>(null);
    readonly audioRegion = signal<EmbeddedMpvFrameRegion | null>(null);

    readonly main: WritableSignal<SourceReadout> = this.readings.main;
    readonly audioReadout: WritableSignal<SourceReadout> =
        this.readings.audioReadout;

    /** Audio channel clock minus main clock, smoothed; null until stable. */
    readonly offset = this.readings.offset;
    readonly delay = computed(() => this.options.audio()?.delaySeconds ?? 0);
    /** The offset on show: live readings, or the last measure. */
    readonly shownOffset = computed<number | null>(() => {
        const mode = this.viewMode();
        if (mode === 'compare') return this.compare.offset();
        return mode === 'measure'
            ? (this.measure.last()?.offset ?? null)
            : this.offset();
    });
    readonly residual = computed(() => {
        const offset = this.shownOffset();
        return offset === null ? null : residualSeconds(offset, this.delay());
    });
    readonly suggestion = computed(() => {
        const offset = this.shownOffset();
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
    /** Bumped by open/close/restart; stale async work checks it. */
    private epoch = 0;
    private previewStartedAt = 0;
    private readonly trackers = this.readings.trackers;
    private readonly smoother: OffsetSmoother = this.readings.smoother;
    private readonly preview = new AudioSyncPreview({
        api: () => this.options.api(),
        audio: () => this.options.audio(),
        toPlayback: (audio) => this.options.toPlayback(audio),
        onPlaying: () => this.previewStatus.set('live'),
        onFailed: () => this.failPreview(),
    });
    private readonly slot = new AudioSyncSlot({
        suspend: () => this.options.suspendAudio(),
        resume: () => this.options.resumeAudio(),
        settleMs: () => this.options.settleMs,
    });
    private autoMeasureTimer: ReturnType<typeof setTimeout> | null = null;
    private autoFallbackUsed = false;
    private measuredSinceBegin = false;
    readonly measure: AudioSyncMeasure = new AudioSyncMeasure({
        now: () => this.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        hasRegions: () => this.hasRegions(),
        startPreview: () => this.startPreview(this.audioRegion()),
        stopPreview: () => this.stopPreview(),
        previewFailed: () => this.previewStatus() === 'failed',
        sampleCount: () => this.smoother.size,
        median: () => this.smoother.median,
        sawAudioFrames: () => this.previewStatus() === 'live',
        texts: (): { main: string | null; audio: string | null } => ({
            main: this.main().text,
            audio: this.audioReadout().text,
        }),
    });
    private readonly now: () => number;
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

    constructor(private readonly options: AudioSyncOptions) {
        this.now = options.now ?? (() => performance.now());
        this.storage =
            options.storage === undefined
                ? safeLocalStorage()
                : options.storage;
        this.viewMode.set(loadViewMode(this.storage));

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
        this.measuredSinceBegin = false;
        this.compare.clear();
        void this.begin();
    }

    close(): void {
        if (!this.isOpen()) return;
        this.isOpen.set(false);
        this.epoch++;
        this.preview.cancel();
        this.measure.cancel();
        if (this.autoMeasureTimer !== null) clearTimeout(this.autoMeasureTimer);
        this.autoMeasureTimer = null;
        this.stopTimer();
        void this.stopPreview();
        this.readings.reset();
        this.previewStatus.set('idle');
        void this.options.ocr.dispose();
    }

    toggle(): void {
        if (this.isOpen()) this.close(); else this.open();
    }

    /** Back to picking the scoreboard region(s). */
    startPicking(source: SyncSourceKey = 'audio'): void {
        if (!this.isOpen()) return;
        this.mode.set('pick');
        this.pickSource.set(source);
        this.readings.reset();
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

        // The other picture still needs a region (comparing needs only the
        // audio channel's: the picture's clock is read off the screen).
        if (this.viewMode() !== 'compare') {
            if (source === 'audio' && !this.mainRegion()) {
                this.pickSource.set('main');
                return;
            }
            if (source === 'main' && !this.audioRegion()) {
                this.pickSource.set('audio');
                return;
            }
        }
        this.mode.set('live');
        // Measure view keeps no picture open: give the sound its slot back,
        // then measure with the region just picked.
        if (this.viewMode() === 'measure') {
            void this.stopPreview().then(() => this.measureNow());
        } else {
            void this.startPreview(this.audioRegion());
        }
    }

    /** Switches between measuring once and keeping a live picture. */
    setViewMode(mode: ViewMode): void {
        if (this.viewMode() === mode) return;
        this.viewMode.set(mode);
        saveViewMode(this.storage, mode);
        this.fallbackNotice.set(false);
        if (!this.isOpen() || this.mode() === 'pick') return;
        this.readings.reset();
        if (mode === 'compare') {
            this.measure.cancel();
            this.mode.set('live');
            void this.stopPreview().then(() => this.startComparePreview());
        } else if (mode === 'live' && this.hasRegions()) {
            // Hand the sound back first: only measuring and comparing keep it
            // paused while the picture takes its connection.
            void this.stopPreview().then(() =>
                this.startPreview(this.audioRegion())
            );
        } else {
            this.measure.cancel();
            void this.stopPreview();
            this.showMeasureIdle();
        }
    }

    /** Reads both clocks once with a temporary picture of the audio channel. */
    async measureNow(): Promise<void> {
        this.measuredSinceBegin = true;
        if (this.autoMeasureTimer) {
            clearTimeout(this.autoMeasureTimer);
            this.autoMeasureTimer = null;
        }
        if (this.viewMode() !== 'measure') this.setViewMode('measure');
        this.readings.resetKeepMain();
        this.audioReadout.set({ ...EMPTY_READOUT, problem: 'noFrame' });
        await this.measure.run();
        this.readings.resetKeepMain();
        this.showMeasureIdle();
    }

    /** The user types the real clock of a source; OCR re-confirms it later. */
    setManualClock(source: SyncSourceKey, text: string): boolean {
        const seconds = parseManualClock(text);
        if (seconds === null) return false;
        this.trackers[source].setManual(seconds, this.now());
        this.smoother.clear();
        this.readings.refresh();
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
        this.readings.reset();
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

        if (this.viewMode() === 'compare') {
            this.mode.set('live');
            await this.startComparePreview();
        } else if (!this.audioRegion() || !this.mainRegion()) {
            this.mode.set('pick');
            this.pickSource.set(this.audioRegion() ? 'main' : 'audio');
            await this.startPreview(null);
        } else if (this.viewMode() === 'live') {
            this.mode.set('live');
            await this.startPreview(this.audioRegion());
        } else {
            this.mode.set('live');
            this.showMeasureIdle();
            // Read the clocks right away; the sound that was just chosen gets
            // a moment to start first.
            this.autoMeasureTimer = setTimeout(() => {
                if (
                    epoch === this.epoch &&
                    this.isOpen() &&
                    !this.measuredSinceBegin
                ) {
                    void this.measureNow();
                }
            }, AUTO_MEASURE_DELAY_MS);
        }
        if (epoch === this.epoch) this.startTimer();
    }

    /** The audio channel's scoreboard corner, kept on screen to compare. */
    private async startComparePreview(): Promise<void> {
        if (!this.isOpen()) return;
        this.audioRegion.update((r) => r ?? { ...DEFAULT_CLOCK_REGION });
        await this.startPreview(this.audioRegion());
    }

    private async startPreview(
        region: EmbeddedMpvFrameRegion | null
    ): Promise<void> {
        this.previewStatus.set('starting');
        this.previewStartedAt = this.now();
        this.audioReadout.set({ ...EMPTY_READOUT, problem: 'noFrame' });
        // Measuring and comparing: the picture takes the sound's connection slot.
        if (this.viewMode() !== 'live') {
            this.slot.take();
            await this.slot.ready();
            if (!this.isOpen()) return; // closed while the sound's connection closed
        }
        await this.preview.start(region);
    }

    private async stopPreview(): Promise<void> {
        await this.preview.stop();
        await this.slot.give();
    }

    private failPreview(): void {
        this.previewStatus.set('failed');
        this.audioReadout.set({ ...EMPTY_READOUT, problem: 'failed' });
        this.readings.resetKeepMain();
        // Comparing paused the sound for the picture: do not leave it silent.
        if (this.viewMode() !== 'live' && this.slot.isTaken) {
            void this.stopPreview();
        }
        // A refused third connection: measure instead (two connections).
        if (
            this.viewMode() === 'live' &&
            this.isOpen() &&
            this.mode() === 'live' &&
            !this.autoFallbackUsed
        ) {
            this.autoFallbackUsed = true;
            this.fallbackNotice.set(true);
            this.viewMode.set('measure');
            saveViewMode(this.storage, 'measure');
            void this.stopPreview().then(() => this.measureNow());
        }
    }

    private showMeasureIdle(): void {
        const last = this.measure.last();
        this.audioReadout.set(
            last
                ? { ...EMPTY_READOUT, text: last.audioText, problem: 'measured' }
                : { ...EMPTY_READOUT, problem: 'idle' }
        );
        this.previewStatus.set('idle');
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

        if (this.viewMode() === 'compare') {
            // Nothing to read: the user compares the two clocks by eye.
            this.checkFirstFrameTimeout(api.captureEmbeddedMpvFrame('preview'));
            return;
        }

        const mainRegion = this.mainRegion();
        const mainFrame = mainRegion && api.captureEmbeddedMpvFrame('main', mainRegion, MAIN_CAPTURE_WIDTH);
        const audioFrame = api.captureEmbeddedMpvFrame('preview');
        this.mainFrameListener?.(mainFrame && this.readings.isFresh(mainFrame) ? mainFrame : null);

        if (++this.ticks % OCR_EVERY === 0 && !this.readings.busy) {
            void this.readings.readClocks(mainFrame, audioFrame);
        }
        this.readings.refresh(mainFrame, audioFrame);
        this.checkFirstFrameTimeout(audioFrame);
    }

    private checkFirstFrameTimeout(audioFrame: EmbeddedMpvFrameCapture | null): void {
        if (this.previewStatus() !== 'starting') return;
        if (audioFrame) this.previewStatus.set('live');
        else if (this.now() - this.previewStartedAt > FIRST_FRAME_TIMEOUT_MS) {
            this.failPreview();
        }
    }

    private keyFor(source: SyncSourceKey): string {
        return source === 'main'
            ? this.options.videoUrl()
            : (this.options.audio()?.streamUrl ?? '');
    }
}
