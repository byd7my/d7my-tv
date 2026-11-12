import { computed, effect, signal, untracked } from '@angular/core';
import type {
    PlayerStreamStats,
    PlayerStreamStatsSource,
} from './player-stream-stats.model';
import { buildStreamStatsView } from './stream-stats-view';

/**
 * How often the open popover re-reads the engine. Fast enough that a bitrate
 * or buffer change is visible while watching a row, slow enough that the
 * numbers stay readable instead of flickering.
 */
export const STREAM_STATS_SAMPLE_INTERVAL_MS = 1000;

/**
 * Owns the stream-info popover's sampling loop.
 *
 * Sampling runs only between {@link start} and {@link stop} — i.e. only while
 * the popover is open — so a closed panel costs nothing, and the engine's own
 * frame-rate accounting is not driven by a UI nobody is looking at.
 */
export class ControlsStreamStats {
    private readonly snapshot = signal<PlayerStreamStats | null>(null);
    private timer: ReturnType<typeof setInterval> | null = null;

    readonly view = computed(() => buildStreamStatsView(this.snapshot()));
    readonly hasRows = computed(() => this.view().sections.length > 0);
    /** Plain-language explanations under each row; off for people who know the terms. */
    readonly showHints = signal(false);

    constructor(
        private readonly source: () =>
            PlayerStreamStatsSource | null | undefined
    ) {}

    /**
     * Samples only while `open()` is true. Every close path (toggle, Escape,
     * capability loss, teardown) runs through that signal, so the sampler can
     * never outlive the panel it feeds. Call it in an injection context.
     */
    bindTo(open: () => boolean): void {
        effect((onCleanup) => {
            if (!open()) {
                return;
            }
            untracked(() => this.start());
            onCleanup(() => this.stop());
        });
    }

    toggleHints(): void {
        this.showHints.update((on) => !on);
    }

    start(): void {
        this.stop();
        try {
            this.source()?.reset?.();
        } catch {
            // Diagnostic sources must never break playback during teardown.
        }
        this.sample();
        this.timer = setInterval(
            () => this.sample(),
            STREAM_STATS_SAMPLE_INTERVAL_MS
        );
    }

    /** Idempotent; drops the snapshot so a reopen never shows stale numbers. */
    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.snapshot.set(null);
    }

    dispose(): void {
        this.stop();
    }

    private sample(): void {
        try {
            this.snapshot.set(this.source()?.sample() ?? null);
        } catch {
            // A stats read is diagnostic only: an engine that throws mid-teardown
            // must never take the controls down with it.
            this.snapshot.set(null);
        }
    }
}
