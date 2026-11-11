import { CONNECTION_SETTLE_MS } from './audio-sync.model';

interface SlotHost {
    /** Drops the audio channel's sound (frees its connection). */
    suspend: () => void;
    /** Plays the chosen audio channel again. */
    resume: () => void;
    settleMs?: () => number | undefined;
}

/**
 * The sound's connection slot. While the picture is open the sound steps
 * aside; both moves wait for the provider to see the old connection closed
 * before the next one opens.
 */
export class AudioSyncSlot {
    private taken = false;
    private settling: Promise<void> = Promise.resolve();

    constructor(private readonly host: SlotHost) {}

    get isTaken(): boolean {
        return this.taken;
    }

    /** The picture takes the slot (a no-op while it already has it). */
    take(): void {
        if (this.taken) return;
        this.taken = true;
        this.host.suspend();
        this.settling = this.settle();
    }

    /** Resolves once a released sound connection has had time to close. */
    ready(): Promise<void> {
        return this.settling;
    }

    /** The picture is gone: the sound comes back, unless a picture took the slot again. */
    async give(): Promise<void> {
        if (!this.taken) return;
        this.taken = false;
        await this.settle();
        if (!this.taken) this.host.resume();
    }

    private async settle(): Promise<void> {
        const ms = this.host.settleMs?.() ?? CONNECTION_SETTLE_MS;
        if (ms <= 0) return;
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }
}
