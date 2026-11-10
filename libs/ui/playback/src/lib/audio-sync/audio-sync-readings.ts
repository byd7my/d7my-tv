import { signal } from '@angular/core';
import type { EmbeddedMpvFrameCapture } from '@iptvnator/shared/interfaces';
import {
    formatMatchClock,
    MatchClockTracker,
    parseMatchClock,
} from '../match-clock/match-clock.util';
import { OffsetSmoother } from './audio-sync-math';
import {
    AudioSyncOptions,
    EMPTY_READOUT,
    sameReadout,
    SourceProblem,
    SourceReadout,
    STALE_AFTER_MS,
    SyncSourceKey,
} from './audio-sync.model';

export interface ReadingsHost {
    now(): number;
    recognize: AudioSyncOptions['ocr']['recognize'];
    /** Bumped when the window restarts; stale OCR results are dropped. */
    epoch(): number;
    previewFailed(): boolean;
    /** Measure view with no picture open: the audio side is not live. */
    audioSideIdle(): boolean;
}

/** The two clocks as read from the pictures, and their smoothed difference. */
export class AudioSyncReadings {
    readonly main = signal<SourceReadout>(EMPTY_READOUT, { equal: sameReadout });
    readonly audioReadout = signal<SourceReadout>(EMPTY_READOUT, {
        equal: sameReadout,
    });
    /** Audio channel clock minus main clock, smoothed; null until stable. */
    readonly offset = signal<number | null>(null);
    readonly ocrFailed = signal(false);
    readonly trackers: Record<SyncSourceKey, MatchClockTracker> = {
        main: new MatchClockTracker(),
        audio: new MatchClockTracker(),
    };
    readonly smoother = new OffsetSmoother();
    private ocrBusy = false;

    constructor(private readonly host: ReadingsHost) {}

    get busy(): boolean {
        return this.ocrBusy;
    }

    isFresh(frame: EmbeddedMpvFrameCapture | null): boolean {
        return frame !== null && frame.ageMs <= STALE_AFTER_MS;
    }

    async readClocks(
        mainFrame: EmbeddedMpvFrameCapture | null,
        audioFrame: EmbeddedMpvFrameCapture | null
    ): Promise<void> {
        this.ocrBusy = true;
        const epoch = this.host.epoch();
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
                const reading = await this.host.recognize(
                    frame as EmbeddedMpvFrameCapture
                );
                if (epoch !== this.host.epoch()) return;
                this.trackers[source].ingest(
                    parseMatchClock(reading.text),
                    reading.confidence,
                    this.host.now()
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

    updateOffset(): void {
        const now = this.host.now();
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

    refresh(
        mainFrame?: EmbeddedMpvFrameCapture | null,
        audioFrame?: EmbeddedMpvFrameCapture | null
    ): void {
        const now = this.host.now();
        const sources: Array<
            [SyncSourceKey, EmbeddedMpvFrameCapture | null | undefined]
        > = [
            ['main', mainFrame],
            ['audio', audioFrame],
        ];
        for (const [source, frame] of sources) {
            const target = source === 'main' ? this.main : this.audioReadout;
            if (source === 'audio' && this.host.previewFailed()) continue;
            // The audio side shows the last measure, never a stale picture
            // passed off as live.
            if (source === 'audio' && this.host.audioSideIdle()) continue;
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

    resetKeepMain(): void {
        this.trackers.audio.reset();
        this.smoother.clear();
        this.offset.set(null);
    }

    reset(): void {
        this.trackers.main.reset();
        this.resetKeepMain();
        this.main.set(EMPTY_READOUT);
        this.audioReadout.set(EMPTY_READOUT);
        this.ocrFailed.set(false);
    }
}
