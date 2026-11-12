import type { SplitAudioHost } from './embedded-mpv-split-audio';
import type { SyncSide } from './split-audio-sync-run';

/** A session resumed by the freeze reports `playing` again for this long. */
export const RESUME_GRACE_MS = 3000;

/**
 * The sync freeze of one session: it pauses below the user's pause (the host
 * `hold`), never resumes what the user paused, and - when the user chose it -
 * lets the picture's own audio play while the external sound is frozen, with
 * the two never audible together.
 */
export class FreezeHolds {
    private held: Record<SyncSide, boolean> = { picture: false, sound: false };
    private releasedAt: Record<SyncSide, number> = {
        picture: -1e9,
        sound: -1e9,
    };
    private audible = false;
    private original = false;

    constructor(
        private readonly host: SplitAudioHost,
        private readonly mainId: string,
        private readonly soundId: () => string | null,
        private readonly volume: () => number,
        private readonly userPaused: () => boolean
    ) {}

    get originalAudio(): boolean {
        return this.original;
    }

    isHeld(side: SyncSide): boolean {
        return this.held[side];
    }

    /** True while a freeze, or the resume that ends it, explains a status change. */
    owns(side: SyncSide): boolean {
        return (
            this.held[side] ||
            this.host.now() - this.releasedAt[side] < RESUME_GRACE_MS
        );
    }

    setOriginalAudio(on: boolean): void {
        this.original = on;
        if (!on && this.audible) this.setAudible(false);
    }

    /** The user moved the volume: the picture's audio, if on, follows it. */
    onVolume(volume: number): void {
        if (this.audible) this.host.setVolume(this.mainId, volume);
    }

    hold(side: SyncSide, on: boolean): void {
        const id = side === 'picture' ? this.mainId : this.soundId();
        if (!id) return;
        this.held[side] = on;
        if (!on) this.releasedAt[side] = this.host.now();
        if (side === 'sound' && this.original) {
            // Never both at once: the sound goes quiet before the picture's
            // own audio comes up, and the picture is muted before the sound
            // resumes (the commands reach the session in this order).
            if (on) {
                this.host.hold(id, true);
                this.setAudible(true);
                return;
            }
            this.setAudible(false);
        }
        // The user's pause wins: a release never resumes what they paused.
        if (on || !this.userPaused()) this.host.hold(id, on);
    }

    private setAudible(on: boolean): void {
        this.audible = on;
        this.host.setVolume(this.mainId, on ? this.volume() : 0);
    }
}
