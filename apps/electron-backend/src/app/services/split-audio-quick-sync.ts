import type { EmbeddedMpvSplitAudioStatus } from '@iptvnator/shared/interfaces';
import type { SplitAudioHost } from './embedded-mpv-split-audio';
import { cacheBudget } from './split-audio-cache';
import type { SyncSide } from './split-audio-sync-types';

type Quick = NonNullable<EmbeddedMpvSplitAudioStatus['quickSync']>;

/** Longest a quick jump back may be, and the history it needs on top. */
const MAX_JUMP_SECONDS = 30;
const HISTORY_SECONDS = 5;
const MIN_JUMP_SECONDS = 0.3;
const CACHE_HEADROOM = 1.25;

export interface QuickInput {
    /** Lateness now (positive: sound behind); null when nothing is known. */
    lateness: number | null;
    target: number;
    /** How long the pair has been playing: the history that can be jumped into. */
    playedSeconds: number;
    /** Seconds the side's cache keeps behind the playhead. */
    backSeconds(side: SyncSide): number;
}

/**
 * What the "quick sync" button may do: the side that is ahead jumps back by
 * the difference, if there is a reading, history to jump into and a cache that
 * really keeps that much behind the playhead. Pure; the pair does the jump.
 */
export function planQuickJump(
    input: QuickInput
): Quick | { kind: 'jump'; side: SyncSide; seconds: number } {
    if (input.lateness === null) {
        return { kind: 'unavailable', why: 'no-reading' };
    }
    const gap = input.lateness - input.target;
    const seconds = Math.round(Math.abs(gap) * 10) / 10;
    if (seconds < MIN_JUMP_SECONDS) return { kind: 'nothing' };
    if (seconds > MAX_JUMP_SECONDS) {
        return { kind: 'unavailable', why: 'too-far' };
    }
    if (input.playedSeconds < seconds + HISTORY_SECONDS) {
        return { kind: 'unavailable', why: 'no-history' };
    }
    const side: SyncSide = gap > 0 ? 'picture' : 'sound';
    if (input.backSeconds(side) < seconds * CACHE_HEADROOM + HISTORY_SECONDS) {
        return { kind: 'unavailable', why: 'cache' };
    }
    return { kind: 'jump', side, seconds };
}

export interface QuickContext {
    host: SplitAudioHost;
    mainId: string;
    soundId: string | null;
    userPaused: boolean;
    lateness: number | null;
    target: number;
    startedAt: number;
    /** Before the jump: an automatic run in progress must end. */
    beforeJump(): void;
    /** After the jump: what was measured is void. */
    afterJump(): void;
}

/** Plans the quick sync and, when it can, does the jump of the one side. */
export function runQuickSync(c: QuickContext): Quick {
    const id = c.soundId;
    if (!id || c.userPaused) return { kind: 'unavailable', why: 'no-reading' };
    const plan = planQuickJump({
        lateness: c.lateness,
        target: c.target,
        playedSeconds: (c.host.now() - c.startedAt) / 1000,
        backSeconds: (side) => {
            const sid = side === 'picture' ? c.mainId : id;
            return cacheBudget(
                c.host.cacheOptions(sid),
                c.host.snapshot(sid)?.bitrateBps ?? null,
                'back'
            ).seconds;
        },
    });
    if (plan.kind !== 'jump') return plan;
    c.beforeJump();
    c.host.jump(plan.side === 'picture' ? c.mainId : id, -plan.seconds);
    c.afterJump();
    return { kind: 'jumped', side: plan.side, seconds: plan.seconds };
}
