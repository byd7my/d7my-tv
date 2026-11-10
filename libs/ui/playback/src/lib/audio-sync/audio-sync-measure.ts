import { signal } from '@angular/core';

export type MeasureError = 'noRegion' | 'failed' | 'noClock';

export interface MeasureResult {
    /** Audio channel clock minus main clock, in seconds. */
    offset: number;
    mainText: string | null;
    audioText: string | null;
}

/** Readings (about one a second) needed before the offset is trusted. */
const MIN_SAMPLES = 6;
/** Gives up after this long (opening the stream is most of it). */
const TIMEOUT_MS = 30000;
const POLL_MS = 250;

export interface MeasureHost {
    now(): number;
    sleep(ms: number): Promise<void>;
    hasRegions(): boolean;
    /** Frees a connection slot and opens the audio channel's picture. */
    startPreview(): Promise<void>;
    /** Closes the picture and gives the audio channel its slot back. */
    stopPreview(): Promise<void>;
    previewFailed(): boolean;
    sampleCount(): number;
    median(): number | null;
    sawAudioFrames(): boolean;
    texts(): { main: string | null; audio: string | null };
}

/**
 * "Measure once" mode. Providers often allow two connections (the video and
 * the audio channel) but refuse a third, so the audio channel's sound is
 * dropped for a few seconds, its picture takes that connection, the clocks
 * are read, then the picture is closed and the sound comes back. Never more
 * than two connections at a time.
 */
export class AudioSyncMeasure {
    readonly running = signal(false);
    readonly error = signal<MeasureError | null>(null);
    readonly last = signal<MeasureResult | null>(null);
    private cancelled = false;

    constructor(private readonly host: MeasureHost) {}

    cancel(): void {
        this.cancelled = true;
    }

    clear(): void {
        this.last.set(null);
        this.error.set(null);
    }

    async run(): Promise<boolean> {
        if (this.running()) return false;
        this.cancelled = false;
        this.error.set(null);
        if (!this.host.hasRegions()) {
            this.error.set('noRegion');
            return false;
        }
        this.running.set(true);
        try {
            await this.host.startPreview();
            const deadline = this.host.now() + TIMEOUT_MS;
            while (this.host.now() < deadline && !this.cancelled) {
                await this.host.sleep(POLL_MS);
                if (this.host.previewFailed()) {
                    this.error.set('failed');
                    return false;
                }
                const median = this.host.median();
                if (this.host.sampleCount() >= MIN_SAMPLES && median !== null) {
                    this.last.set({ offset: median, ...this.snapshotTexts() });
                    return true;
                }
            }
            if (!this.cancelled) {
                this.error.set(this.host.sawAudioFrames() ? 'noClock' : 'failed');
            }
            return false;
        } finally {
            await this.host.stopPreview();
            this.running.set(false);
        }
    }

    private snapshotTexts(): Pick<MeasureResult, 'mainText' | 'audioText'> {
        const { main, audio } = this.host.texts();
        return { mainText: main, audioText: audio };
    }
}
