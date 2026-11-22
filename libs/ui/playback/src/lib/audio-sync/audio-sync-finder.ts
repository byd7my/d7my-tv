import { signal } from '@angular/core';
import type {
    EmbeddedMpvFrameCapture,
    EmbeddedMpvFrameRegion,
} from '@iptvnator/shared/interfaces';

/**
 * Looks for the match clock in the whole picture the region picker shows, so a
 * new channel's graphics need no hand-drawn box. It runs on request (the
 * button) and once when a picture arrives with no area chosen yet; the person
 * can always drag a box instead.
 */
export class AudioSyncFinder {
    readonly finding = signal(false);
    /** The last search found no clock: the person is asked to draw it. */
    readonly failed = signal(false);
    private frame: EmbeddedMpvFrameCapture | null = null;
    private tried = false;

    constructor(
        private readonly locate: (
            frame: EmbeddedMpvFrameCapture
        ) => Promise<EmbeddedMpvFrameRegion | null>
    ) {}

    /** Keeps the latest full picture to search in. */
    see(frame: EmbeddedMpvFrameCapture | null): void {
        this.frame = frame;
    }

    /** A new pick (another source, or the picker reopened): search anew. */
    reset(): void {
        this.tried = false;
        this.failed.set(false);
    }

    /** The person went back to the original area: do not search for them. */
    skipAuto(): void {
        this.tried = true;
    }

    /** The first picture of a pick with nothing chosen yet: search once. */
    auto(apply: (region: EmbeddedMpvFrameRegion) => void): void {
        if (this.tried || !this.frame) return;
        void this.run(apply);
    }

    async run(apply: (region: EmbeddedMpvFrameRegion) => void): Promise<void> {
        const frame = this.frame;
        if (!frame || this.finding()) return;
        this.tried = true;
        this.finding.set(true);
        this.failed.set(false);
        try {
            const region = await this.locate(frame);
            if (region) apply(region);
            else this.failed.set(true);
        } finally {
            this.finding.set(false);
        }
    }
}
