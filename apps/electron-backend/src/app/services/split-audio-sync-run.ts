/**
 * One automatic sync, started by the user and ended by itself.
 *
 *   measuring -> (announcing -> freezing -> resuming -> settling) -> fine -> done
 *
 * The run reads the clock readings until they are stable, then
 *  - a gap of at most 2 s is left to the fine correction (the corrector);
 *  - a bigger one is closed by ONE freeze of the session that is ahead (the
 *    picture is announced first), followed by the fine correction for what is
 *    left.
 * When the difference is inside the accuracy margin the run is `done`: from
 * then on nothing here touches a speed or a session again, whatever the
 * clocks say, until the user starts another run. A run that cannot get there
 * ends `failed` with the difference that is left; it never freezes twice.
 *
 * It owns no mpv state: it asks `SyncRunIO` for everything, so it is unit
 * tested with a fake.
 */
import { SYNC_CONFIG } from './split-audio-sync-config';
import { stableWindow, type StableWindow } from './split-audio-sync-measure';

export { SYNC_CONFIG };
export type * from './split-audio-sync-types';
import type {
    FreezeCut,
    SyncFailure,
    SyncPhase,
    SyncRunIO,
    SyncRunStatus,
    SyncSide,
} from './split-audio-sync-types';

export class AutoSyncRun {
    private phase: SyncPhase = 'idle';
    private readings: { at: number; value: number }[] = [];
    private startedAt = 0;
    private stableSince: number | null = null;
    private side: SyncSide | null = null;
    private freezeSeconds = 0;
    private capped = false;
    private cut: FreezeCut | null = null;
    private failure: SyncFailure | null = null;
    private residual: number | null = null;
    private phaseAt = 0;
    private frozenAt = 0;
    private base: { buffered: number; position: number } | null = null;
    private retried = false;
    private fineAt = 0;
    private okSince: number | null = null;
    private epoch = 0;

    constructor(private readonly io: SyncRunIO) {}

    get active(): boolean {
        return !['idle', 'done', 'failed'].includes(this.phase);
    }

    get current(): SyncPhase {
        return this.phase;
    }

    /** The session whose pause belongs to the run (and its reconnect grace). */
    get held(): SyncSide | null {
        return this.phase === 'freezing' ? this.side : null;
    }

    /** True while the picture is frozen on purpose (the UI must not show a pause). */
    get pictureFrozen(): boolean {
        return this.phase === 'freezing' && this.side === 'picture';
    }

    // ------------------------------------------------------------ commands

    start(): boolean {
        if (this.active) return false;
        const now = this.io.now();
        this.phase = 'measuring';
        this.phaseAt = now;
        this.startedAt = now;
        this.readings = [];
        this.stableSince = null;
        this.side = null;
        this.freezeSeconds = 0;
        this.capped = false;
        this.cut = null;
        this.failure = null;
        this.residual = null;
        this.retried = false;
        this.okSince = null;
        return true;
    }

    /**
     * Ends the run. `failure` null: the user cancelled (back to idle).
     * Whatever was held is released and the speeds are the user's again.
     */
    cancel(failure: SyncFailure | null): void {
        if (!this.active) return;
        const now = this.io.now();
        this.releaseHolds();
        this.io.endFine(now);
        this.phase = failure ? 'failed' : 'idle';
        this.failure = failure;
        this.phaseAt = now;
    }

    addReading(value: number): void {
        if (this.phase !== 'measuring' || !Number.isFinite(value)) return;
        const now = this.io.now();
        this.readings.push({ at: now, value });
        const from = now - SYNC_CONFIG.windowMs;
        this.readings = this.readings.filter((r) => r.at >= from);
    }

    /** About twice a second. */
    tick(): void {
        const now = this.io.now();
        switch (this.phase) {
            case 'measuring':
                return this.tickMeasuring(now);
            case 'announcing':
                if (now - this.phaseAt >= SYNC_CONFIG.pictureAnnounceMs) {
                    this.beginFreeze(now);
                }
                return;
            case 'freezing':
                return this.tickFreezing(now);
            case 'resuming':
                return this.tickResuming(now);
            case 'settling':
                if (now - this.phaseAt >= SYNC_CONFIG.settleAfterFreezeMs) {
                    this.beginFine(now);
                }
                return;
            case 'fine':
                return this.tickFine(now);
            default:
                return;
        }
    }

    status(): SyncRunStatus {
        const now = this.io.now();
        const frozenFor = (now - this.frozenAt) / 1000;
        return {
            phase: this.phase,
            side: this.side,
            freezeSeconds: round1(this.freezeSeconds),
            remainingSeconds:
                this.phase === 'freezing'
                    ? Math.max(0, round1(this.freezeSeconds - frozenFor))
                    : 0,
            announceSeconds:
                this.phase === 'announcing'
                    ? Math.max(
                          0,
                          round1(
                              (SYNC_CONFIG.pictureAnnounceMs -
                                  (now - this.phaseAt)) /
                                  1000
                          )
                      )
                    : 0,
            capped: this.capped,
            freezeCut: this.cut,
            failure: this.failure,
            residualSeconds: this.residual,
            epoch: this.epoch,
        };
    }

    // --------------------------------------------------------------- phases

    private tickMeasuring(now: number): void {
        const st = stableWindow(this.readings.map((r) => r.value));
        if (st) {
            this.stableSince ??= now;
            this.residual = round2(st.median - this.io.target());
            if (now - this.stableSince >= SYNC_CONFIG.confirmMs) {
                return this.decide(st, now);
            }
        } else {
            this.stableSince = null;
        }
        if (now - this.startedAt >= SYNC_CONFIG.measureTimeoutMs) {
            this.fail(
                this.readings.length < SYNC_CONFIG.minReadings
                    ? 'no-clock'
                    : 'unstable'
            );
        }
    }

    private decide(st: StableWindow, now: number): void {
        const target = this.io.target();
        const gap = st.median - target;
        this.residual = round2(gap);
        if (Math.abs(gap) <= SYNC_CONFIG.toleranceSeconds)
            return this.finish(now);
        const direction = Math.sign(gap);
        // Every inlier agrees on the side of the target, not just the median.
        const agree = st.inliers.every(
            (v) => Math.sign(v - target) === direction
        );
        if (Math.abs(gap) <= SYNC_CONFIG.smallGapSeconds || !agree) {
            return this.beginFine(now);
        }
        this.planFreeze(gap, now);
    }

    private planFreeze(gap: number, now: number): void {
        // Lateness positive: the sound is behind, so the picture is ahead.
        this.side = gap > 0 ? 'picture' : 'sound';
        const cap =
            this.side === 'picture'
                ? SYNC_CONFIG.pictureMaxSeconds
                : SYNC_CONFIG.soundMaxSeconds;
        // The player on the other side moves `userSpeed` content seconds per
        // second, so the wait is the gap divided by that.
        const wanted =
            Math.max(1, Math.abs(gap) - SYNC_CONFIG.marginSeconds) /
            Math.max(0.25, this.io.userSpeed());
        this.capped = wanted > cap;
        this.freezeSeconds = Math.min(cap, wanted);
        const verdict = this.cacheVerdict(this.side, this.freezeSeconds);
        if (verdict) {
            this.cut = verdict;
            this.freezeSeconds = 0;
            this.side = null;
            return this.beginFine(now);
        }
        this.phase = 'announcing';
        this.phaseAt = now;
        if (this.side === 'sound') this.beginFreeze(now);
    }

    /** Checked before the freeze: the real cache, not a default's promise. */
    private cacheVerdict(side: SyncSide, seconds: number): FreezeCut | null {
        const probe = this.io.probe(side);
        if (!probe || probe.bufferedAheadSeconds === null) {
            return 'cache-insufficient';
        }
        const budget = this.io.cacheAhead(side, probe.bitrateBps);
        const need =
            probe.bufferedAheadSeconds +
            seconds +
            SYNC_CONFIG.cacheExtraSeconds;
        return budget.seconds < need * SYNC_CONFIG.cacheHeadroom
            ? 'cache-insufficient'
            : null;
    }

    private beginFreeze(now: number): void {
        const side = this.side;
        if (!side) return this.beginFine(now);
        // The probe may have changed in the announce time: check again.
        const verdict = this.cacheVerdict(side, this.freezeSeconds);
        if (verdict) {
            this.cut = verdict;
            this.side = null;
            return this.beginFine(now);
        }
        const probe = this.io.probe(side);
        this.base = {
            buffered: probe?.bufferedAheadSeconds ?? 0,
            position: probe?.positionSeconds ?? 0,
        };
        this.phase = 'freezing';
        this.phaseAt = now;
        this.frozenAt = now;
        this.io.hold(side, true);
    }

    private tickFreezing(now: number): void {
        const side = this.side;
        if (!side) return;
        const elapsed = now - this.frozenAt;
        if (elapsed >= this.freezeSeconds * 1000)
            return this.release(now, null);
        const probe = this.io.probe(side);
        if (!probe) return;
        if (probe.status === 'playing' && elapsed > 1500) {
            // Somebody else resumed it (the user, a reload): not ours to hold.
            return this.cancel('interrupted');
        }
        if (elapsed >= SYNC_CONFIG.growthCheckAfterMs && this.base) {
            if (probe.bufferedAheadSeconds === null) {
                return this.release(now, 'cache-stalled');
            }
            const grown = probe.bufferedAheadSeconds - this.base.buffered;
            if (grown < (elapsed / 1000) * SYNC_CONFIG.growthShare) {
                return this.release(now, 'cache-stalled');
            }
            const budget = this.io.cacheAhead(side, probe.bitrateBps);
            if (
                budget.bytes > 0 &&
                (probe.bufferedAheadSeconds * (probe.bitrateBps ?? 0)) / 8 >
                    budget.bytes * SYNC_CONFIG.cacheFullShare
            ) {
                return this.release(now, 'cache-full');
            }
            if (
                probe.status !== 'paused' &&
                elapsed >= SYNC_CONFIG.growthCheckAfterMs
            ) {
                return this.release(now, 'stream-lost');
            }
        }
    }

    /** The freeze ends (on time or cut short): the side is resumed. */
    private release(now: number, cut: FreezeCut | null): void {
        const side = this.side;
        if (cut) this.cut = cut;
        if (!side) return;
        this.phase = 'resuming';
        this.phaseAt = now;
        this.retried = false;
        this.base = {
            buffered: 0,
            position: this.io.probe(side)?.positionSeconds ?? 0,
        };
        this.io.hold(side, false);
    }

    private tickResuming(now: number): void {
        const side = this.side;
        if (!side) return;
        const probe = this.io.probe(side);
        const moved =
            probe &&
            probe.status === 'playing' &&
            probe.positionSeconds - (this.base?.position ?? 0) >= 0.5;
        if (moved) {
            this.epoch += 1;
            this.phase = 'settling';
            this.phaseAt = now;
            return;
        }
        const waited = now - this.phaseAt;
        if (!this.retried && waited >= SYNC_CONFIG.resumeRetryMs) {
            this.retried = true;
            this.io.hold(side, false);
        } else if (waited >= SYNC_CONFIG.resumeFailMs) {
            this.fail('resume-failed');
            this.io.giveUp();
        }
    }

    private beginFine(now: number): void {
        this.phase = 'fine';
        this.phaseAt = now;
        this.fineAt = now;
        this.okSince = null;
        this.io.beginFine(now);
    }

    private tickFine(now: number): void {
        const fine = this.io.fine();
        if (fine.lateness !== null) {
            this.residual = round2(fine.lateness - this.io.target());
        }
        if (fine.locked) return this.fail('unstable');
        const inside =
            fine.lateness !== null &&
            fine.active === null &&
            fine.reason === 'ok' &&
            Math.abs(fine.lateness - this.io.target()) <=
                SYNC_CONFIG.toleranceSeconds;
        if (inside) {
            this.okSince ??= now;
            if (now - this.okSince >= SYNC_CONFIG.successHoldMs) {
                return this.finish(now);
            }
        } else {
            this.okSince = null;
        }
        if (now - this.fineAt >= SYNC_CONFIG.fineTimeoutMs)
            this.fail('timeout');
    }

    private finish(now: number): void {
        this.io.endFine(now);
        this.phase = 'done';
        this.phaseAt = now;
        this.failure = null;
    }

    private fail(failure: SyncFailure): void {
        const now = this.io.now();
        this.releaseHolds();
        this.io.endFine(now);
        this.phase = 'failed';
        this.failure = failure;
        this.phaseAt = now;
    }

    private releaseHolds(): void {
        if (
            this.side &&
            (this.phase === 'freezing' || this.phase === 'resuming')
        ) {
            this.io.hold(this.side, false);
        }
    }
}

function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}
