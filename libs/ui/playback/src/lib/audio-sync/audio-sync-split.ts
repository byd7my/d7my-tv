import type {
    EmbeddedMpvFrameRegion,
    EmbeddedMpvSplitAudioStatus,
} from '@iptvnator/shared/interfaces';
import type { SyncApi } from './audio-sync.model';

/** What the window needs from the two-session audio mode (AudioSyncOptions.split). */
export interface SplitAudioBridge {
    /** The mode is on for this player: the sound plays in a hidden session. */
    enabled: () => boolean;
    /** The running pair's state; null while it is being (re)opened. */
    status: () => EmbeddedMpvSplitAudioStatus | null;
    /** Lateness of the heard sound behind the picture, seconds; positive: behind. */
    report: (seconds: number, manual: boolean) => void;
    /** Plays the chosen audio channel again, its picture cropped to `region`. */
    reopen: (region: EmbeddedMpvFrameRegion | null) => void;
}

/**
 * The sync window on a two-session pair. The hidden sound session already
 * decodes the audio channel's picture (cropped to its clock), so the window
 * only looks at it: no preview session is created and the sound keeps its
 * connection, which is what keeps the account inside its connection limit.
 * Readings go to the sound correction instead of becoming a suggested delay;
 * the correction closes the gap by itself.
 */
export class AudioSyncSplit {
    private attachedTo: string | null = null;
    private wanted = false;
    private reopenedFor: EmbeddedMpvFrameRegion | null | undefined;
    private lastCompared: number | null = null;

    constructor(
        private readonly bridge: () => SplitAudioBridge | null,
        private readonly api: () => Partial<SyncApi> | undefined
    ) {}

    /** True while the sound is meant to play in a hidden session of its own. */
    get active(): boolean {
        return this.bridge()?.enabled() === true;
    }

    /** Wants the sound session's picture on the preview canvas, cropped to `region`. */
    async start(region: EmbeddedMpvFrameRegion | null): Promise<void> {
        this.wanted = true;
        const split = this.bridge();
        const status = split?.status();
        if (!split || !status) return; // attached by `sync` once it is up
        // The crop is fixed when the session is made: another region needs
        // the sound reopened with it, once per region; the new session is
        // attached by `sync` as soon as it is up.
        if (!sameRegion(status.clockRegion ?? null, region)) {
            if (
                this.reopenedFor === undefined ||
                !sameRegion(this.reopenedFor, region)
            ) {
                this.reopenedFor = region;
                split.reopen(region);
            }
            return;
        }
        await this.attach(status.soundSessionId);
    }

    /**
     * The canvas the picture is painted on changed (the window opened or
     * closed): attach to whichever one is in the page now, on the next tick.
     */
    rebind(): void {
        this.attachedTo = null;
    }

    /** Stops looking; the sound session keeps playing. */
    stop(): void {
        this.wanted = false;
        this.attachedTo = null;
        this.reopenedFor = undefined;
        this.api()?.detachEmbeddedMpvFrameView?.('preview');
    }

    /** Every tick: attaches a session that came up, follows a replaced one. */
    sync(): void {
        const status = this.bridge()?.status();
        if (
            !this.wanted ||
            !status ||
            status.soundSessionId === this.attachedTo
        )
            return;
        // Still the session that is about to be replaced by the reopen.
        const expected = this.reopenedFor;
        if (
            expected !== undefined &&
            !sameRegion(status.clockRegion ?? null, expected)
        ) {
            return;
        }
        void this.attach(status.soundSessionId);
    }

    /** Offset (audio clock minus picture clock) read by the window, about once a second. */
    reportRead(offset: number | null): void {
        if (this.active && offset !== null)
            this.bridge()?.report(-offset, false);
    }

    /** The clocks the user typed in the compare view; sent once per change. */
    reportCompared(offset: number | null): void {
        if (!this.active || offset === null || offset === this.lastCompared)
            return;
        this.lastCompared = offset;
        this.bridge()?.report(-offset, true);
    }

    /** One measurement (OCR of both clocks); steers by dead reckoning. */
    reportMeasured(offset: number | null): void {
        if (this.active && offset !== null)
            this.bridge()?.report(-offset, true);
    }

    private async attach(soundSessionId: string): Promise<void> {
        if (!soundSessionId || this.attachedTo === soundSessionId) return;
        this.attachedTo = soundSessionId;
        const attached = await this.api()?.attachEmbeddedMpvFrameView?.(
            soundSessionId,
            'preview'
        );
        // A session that has only just been spawned can refuse the first
        // attach (its frame ring is not open yet): forget it, so the next
        // tick tries again instead of leaving the picture black for good.
        if (attached === false && this.attachedTo === soundSessionId) {
            this.attachedTo = null;
        }
    }
}

function sameRegion(
    a: EmbeddedMpvFrameRegion | null,
    b: EmbeddedMpvFrameRegion | null
): boolean {
    if (a === null || b === null) return a === b;
    return (
        Math.abs(a.x - b.x) < 1e-3 &&
        Math.abs(a.y - b.y) < 1e-3 &&
        Math.abs(a.width - b.width) < 1e-3 &&
        Math.abs(a.height - b.height) < 1e-3
    );
}
