import type {
    EmbeddedMpvFrameRegion,
    EmbeddedMpvSession,
    EmbeddedMpvSplitAudioQuickResult,
    EmbeddedMpvSplitAudioStatus,
} from '@iptvnator/shared/interfaces';
import type { CorrectionState } from './split-audio-corrector';
import type { SyncRunStatus } from './split-audio-sync-run';

type State = EmbeddedMpvSplitAudioStatus['state'];

export interface PairStatusInput {
    syncMode: 'auto' | 'manual';
    autoOn: boolean;
    userPaused: boolean;
    correction: CorrectionState;
    factors: { main: number; sound: number };
    run: SyncRunStatus;
    soundId: string;
    userSpeed: number;
    clamp(speed: number): number;
    targetSeconds: number;
    dBaseSeconds: number;
    trimSeconds: number;
    audioRate: number | null;
    issue: EmbeddedMpvSplitAudioStatus['issue'];
    disabledReason: string | null;
    manualVoided: EmbeddedMpvSplitAudioStatus['manualVoided'];
    originalAudioDuringFreeze: boolean;
    quick: EmbeddedMpvSplitAudioQuickResult | null;
}

const RUN_STATE: Record<SyncRunStatus['phase'], State> = {
    idle: 'idle',
    measuring: 'measuring',
    announcing: 'announcing',
    freezing: 'freezing',
    resuming: 'resuming',
    settling: 'settling',
    fine: 'measuring',
    done: 'synced',
    failed: 'failed',
};

function round5(value: number): number {
    return Math.round(value * 1e5) / 1e5;
}

function stateOf(i: PairStatusInput): State {
    const s = i.correction;
    if (!i.autoOn) return 'off';
    if (i.userPaused) return 'paused';
    if (i.syncMode === 'auto') {
        if (i.run.phase === 'fine') {
            if (s.locked) return 'locked';
            if (s.active) return 'correcting';
            if (s.reason === 'noisy') return 'noisy';
            return 'measuring';
        }
        return RUN_STATE[i.run.phase];
    }
    if (s.locked) return 'locked';
    if (s.active) return 'correcting';
    if (s.reason === 'settling') return 'settling';
    if (s.reason === 'noisy') return 'noisy';
    return s.lateness !== null ? 'synced' : 'measuring';
}

/** What the pair reports to the controls (see `SplitAudioPair.status`). */
export function buildSplitAudioStatus(
    i: PairStatusInput
): EmbeddedMpvSplitAudioStatus {
    const f = i.factors;
    return {
        mode: 'dual-session',
        syncMode: i.syncMode,
        soundSessionId: i.soundId,
        state: stateOf(i),
        userSpeed: i.userSpeed,
        mainSpeed: round5(i.clamp(i.userSpeed * f.main)),
        soundSpeed: round5(i.clamp(i.userSpeed * f.sound)),
        correcting: i.correction.active,
        rate: i.correction.rate,
        lateness: i.correction.lateness,
        targetSeconds: i.targetSeconds,
        dBaseSeconds: i.dBaseSeconds,
        trimSeconds: i.trimSeconds,
        audioRate: i.audioRate,
        issue: i.issue,
        ...(i.disabledReason ? { autoDisabledReason: i.disabledReason } : {}),
        ...(i.syncMode === 'auto' ? { sync: i.run } : {}),
        manualVoided: i.syncMode === 'manual' ? i.manualVoided : null,
        originalAudioDuringFreeze: i.originalAudioDuringFreeze,
        quickSync: i.quick,
    };
}

/** Overrides what the picture session reports with what the pair means. */
export function decoratePayload(
    pair: {
        volume: number;
        speed: number;
        pictureFrozen: boolean;
        status(): EmbeddedMpvSplitAudioStatus;
    },
    payload: EmbeddedMpvSession,
    clockRegion: EmbeddedMpvFrameRegion | null
): void {
    payload.volume = pair.volume;
    payload.playbackSpeed = pair.speed;
    // A freeze of the sync is not the user's pause: the picture keeps saying
    // "playing" (the countdown says why it stands still).
    if (pair.pictureFrozen && payload.status === 'paused') {
        payload.status = 'playing';
    }
    payload.splitAudio = { ...pair.status(), clockRegion };
}
