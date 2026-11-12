import type { SplitAudioHost } from './embedded-mpv-split-audio';
import { cacheBudget } from './split-audio-cache';
import type { SyncCorrector } from './split-audio-corrector';
import type { SyncRunIO, SyncSide } from './split-audio-sync-run';

export interface RunIOContext {
    host: SplitAudioHost;
    mainId: string;
    soundId(): string | null;
    target(): number;
    userSpeed(): number;
    corrector: SyncCorrector;
    hold(side: SyncSide, on: boolean): void;
    /** Starts / stops the fine correction (and gives the user's speed back). */
    setFine(on: boolean, now: number): void;
    giveUp(): void;
}

/** What the sync run may ask of the pair, in terms of its sessions. */
export function createRunIO(c: RunIOContext): SyncRunIO {
    const idOf = (side: SyncSide) =>
        side === 'picture' ? c.mainId : c.soundId();
    return {
        now: () => c.host.now(),
        target: () => c.target(),
        userSpeed: () => c.userSpeed(),
        hold: (side, on) => c.hold(side, on),
        probe: (side) => {
            const id = idOf(side);
            const snap = id ? c.host.snapshot(id) : null;
            return snap
                ? {
                      status: snap.status,
                      positionSeconds: snap.positionSeconds,
                      bufferedAheadSeconds: snap.bufferedAheadSeconds,
                      bitrateBps: snap.bitrateBps ?? null,
                  }
                : null;
        },
        cacheAhead: (side, bitrate) => {
            const id = idOf(side);
            return cacheBudget(
                id ? c.host.cacheOptions(id) : [],
                bitrate,
                'ahead'
            );
        },
        beginFine: (now) => c.setFine(true, now),
        endFine: (now) => c.setFine(false, now),
        fine: () => {
            const s = c.corrector.state;
            return {
                active: s.active,
                lateness: s.lateness,
                reason: s.reason,
                locked: s.locked,
            };
        },
        giveUp: () => c.giveUp(),
    };
}
