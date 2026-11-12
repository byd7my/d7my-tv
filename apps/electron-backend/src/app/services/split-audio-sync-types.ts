/** Shapes of the automatic sync run (see split-audio-sync-run.ts). */
export type SyncSide = 'picture' | 'sound';
export type SyncPhase =
    | 'idle'
    | 'measuring'
    | 'announcing'
    | 'freezing'
    | 'resuming'
    | 'settling'
    | 'fine'
    | 'done'
    | 'failed';
export type SyncFailure =
    | 'no-clock'
    | 'unstable'
    | 'timeout'
    | 'interrupted'
    | 'resume-failed'
    | 'faulted';
/** Why a freeze did not run its course (the run went on gradually). */
export type FreezeCut =
    'cache-insufficient' | 'cache-stalled' | 'cache-full' | 'stream-lost';

export interface SideProbe {
    status: string;
    positionSeconds: number;
    bufferedAheadSeconds: number | null;
    bitrateBps: number | null;
}

export interface FineState {
    active: 'main' | 'sound' | null;
    /** Median lateness the corrector sees (positive: sound behind). */
    lateness: number | null;
    reason: string;
    locked: boolean;
}

export interface SyncRunIO {
    now(): number;
    /** D_base + trim. */
    target(): number;
    userSpeed(): number;
    /** Pauses/resumes one session below the user's pause (never touches it). */
    hold(side: SyncSide, on: boolean): void;
    probe(side: SyncSide): SideProbe | null;
    /** Seconds of media the side's cache may hold ahead, bytes alongside. */
    cacheAhead(
        side: SyncSide,
        bitrateBps: number | null
    ): {
        seconds: number;
        bytes: number;
    };
    /** Starts the corrector on what it is fed from now on. */
    beginFine(now: number): void;
    /** Stops the corrector and gives both sessions the user's speed. */
    endFine(now: number): void;
    fine(): FineState;
    /** The sound did not come back: the owner must end the pair. */
    giveUp(): void;
}

export interface SyncRunStatus {
    phase: SyncPhase;
    side: SyncSide | null;
    /** Planned length of the freeze, seconds. */
    freezeSeconds: number;
    /** Seconds left of the freeze (counts down once frozen). */
    remainingSeconds: number;
    /** Seconds before the announced freeze starts. */
    announceSeconds: number;
    /** The gap was larger than the freeze may be. */
    capped: boolean;
    freezeCut: FreezeCut | null;
    failure: SyncFailure | null;
    /** What is left of the difference, seconds (positive: sound behind). */
    residualSeconds: number | null;
    /** Counts every end of a freeze: readers drop what they smoothed. */
    epoch: number;
}
