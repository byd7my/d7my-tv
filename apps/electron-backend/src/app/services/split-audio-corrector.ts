/**
 * Closed-loop corrector of the two-session "audio from another channel" mode.
 *
 * The picture (main session, muted) and the sound (second session, picture
 * hidden) come from two different streams, so the heard sound is `lateness`
 * seconds behind the picture (negative: ahead). The corrector never speeds
 * anything up (a live stream cannot run past its live edge); it slows down
 * the session that is AHEAD by a small, bounded rate until the lateness meets
 * the target, then lets go:
 *
 *  - sound too late  -> slow the main picture (muted: nothing is heard),
 *  - sound too early -> slow the sound session (pitch kept by mpv's scaletempo).
 *
 * The result is a pair of factors (1 = untouched). They are kept apart from
 * the user's own playback speed: the service multiplies them.
 *
 * Pure and clock-injected: it only ever sees readings and `now`.
 */
export interface CorrectorConfig {
    /** Seconds the rate aims to close an error in (rate = |error| / tc). */
    tcSeconds: number;
    /** Start correcting above this many seconds of error. */
    enterSeconds: number;
    /** Stop correcting below this many seconds of error. */
    exitSeconds: number;
    /** Largest slowdown of the muted main picture (0.06 = 6 %). */
    maxMainRate: number;
    /** Largest slowdown of the sound session (kept small: it is heard). */
    maxSoundRate: number;
    /** Smallest slowdown worth applying. */
    minRate: number;
    /** Readings older than this leave the median window. */
    windowMs: number;
    minReadings: number;
    /** A window whose spread exceeds this (seconds) is not trusted. */
    madLimitSeconds: number;
    /**
     * A single manual reading that is NOT being steered (idle, locked, held)
     * is dropped after this long.
     */
    manualHorizonMs: number;
    /**
     * Longest a manual reading may steer. While a correction is under way the
     * reading stays: closing a 10 s gap at 3 % takes over five minutes, far
     * more than `manualHorizonMs`, and a reading that expired half way left
     * the rest of the gap in place without a word.
     */
    manualMaxMs: number;
    /** Direction changes allowed in `lockWindowMs` before correction stops. */
    maxFlips: number;
    lockWindowMs: number;
}

export const DEFAULT_CORRECTOR_CONFIG: CorrectorConfig = {
    tcSeconds: 25,
    enterSeconds: 0.12,
    exitSeconds: 0.06,
    maxMainRate: 0.06,
    maxSoundRate: 0.03,
    minRate: 0.01,
    windowMs: 9000,
    minReadings: 4,
    madLimitSeconds: 0.35,
    manualHorizonMs: 150000,
    manualMaxMs: 30 * 60000,
    maxFlips: 3,
    lockWindowMs: 90000,
};

export type CorrectionTarget = 'main' | 'sound';

export interface CorrectionState {
    /** Which session is being slowed, null while idle. */
    active: CorrectionTarget | null;
    /** Slowdown of the active session (0.03 = 3 % slower). */
    rate: number;
    /** Estimated lateness of the sound now, null without a usable reading. */
    lateness: number | null;
    /** Lateness minus target, null without an estimate. */
    error: number | null;
    /** Too many direction changes: no more correction until `reset`. */
    locked: boolean;
    /** Why there is no estimate: `none`, `settling`, `noisy`, `stale`. */
    reason: 'ok' | 'none' | 'settling' | 'noisy' | 'stale';
}

interface Reading {
    at: number;
    value: number;
    /** Cumulative applied slope when the reading was taken. */
    cum: number;
    manual: boolean;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class SyncCorrector {
    private readings: Reading[] = [];
    private target = 0;
    private active: CorrectionTarget | null = null;
    private rate = 0;
    private holdUntil = 0;
    private locked = false;
    private lockedAt = 0;
    private flips: number[] = [];
    private lastDirection: CorrectionTarget | null = null;
    /** Integral of dLateness/dt caused by the factors applied so far. */
    private cum = 0;
    private cumAt = 0;
    /** The user's playback speed: lateness is in content seconds, which pass this much faster. */
    private speedScale = 1;
    private lastState: CorrectionState = this.blank('none');

    constructor(
        private readonly config: CorrectorConfig = DEFAULT_CORRECTOR_CONFIG
    ) {}

    setTarget(seconds: number): void {
        this.target = Number.isFinite(seconds) ? seconds : 0;
    }

    /**
     * The user's playback speed. Both sessions run at `speed x factor`, so a
     * slowdown closes the gap `speed` times faster per wall second; the dead
     * reckoning has to know, or it believes the gap closed at 1x.
     */
    setSpeed(speed: number, now: number): void {
        this.advance(now);
        this.speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1;
    }

    /** A measured lateness (positive: the sound is behind the picture). */
    addReading(lateness: number, now: number): void {
        if (!Number.isFinite(lateness)) return;
        this.advance(now);
        this.readings.push({
            at: now,
            value: lateness,
            cum: this.cum,
            manual: false,
        });
        this.trim(now);
    }

    /**
     * One trusted reading (typed by the user): replaces the window and steers
     * by dead reckoning, since no further reading may follow.
     */
    setManual(lateness: number, now: number): void {
        if (!Number.isFinite(lateness)) return;
        this.advance(now);
        this.readings = [
            { at: now, value: lateness, cum: this.cum, manual: true },
        ];
        this.locked = false;
        this.flips = [];
    }

    /**
     * Pause, seek, reload, reconnect: what was measured is void. Readings are
     * dropped, correction stops (the caller restores the speeds) and nothing
     * is decided for `settleMs`.
     */
    reset(now: number, settleMs: number): void {
        this.readings = [];
        this.active = null;
        this.rate = 0;
        this.holdUntil = now + settleMs;
        this.locked = false;
        this.flips = [];
        this.lastDirection = null;
        this.cum = 0;
        this.cumAt = now;
        this.lastState = this.blank('settling');
    }

    /** Releases the correction at once (the caller restores the speeds). */
    release(now: number, holdMs: number): void {
        this.advance(now);
        this.active = null;
        this.rate = 0;
        this.holdUntil = Math.max(this.holdUntil, now + holdMs);
    }

    get state(): CorrectionState {
        return this.lastState;
    }

    /** Factors for (main, sound); (1, 1) while idle. */
    get factors(): { main: number; sound: number } {
        const slowed = 1 / (1 + this.rate);
        return {
            main: this.active === 'main' ? slowed : 1,
            sound: this.active === 'sound' ? slowed : 1,
        };
    }

    /** Decides from the readings; returns true when the factors changed. */
    step(now: number): boolean {
        this.advance(now);
        this.trim(now);
        const before = `${this.active}:${this.rate.toFixed(4)}`;
        const estimate = this.estimate();
        if (now < this.holdUntil) {
            this.lastState = this.blank('settling');
        } else if (estimate.value === null) {
            this.lastState = this.blank(estimate.reason);
            // No trustworthy number: do not keep steering on a stale guess.
            if (estimate.reason !== 'none' || this.readings.length === 0) {
                this.stop();
            }
        } else {
            this.decide(estimate.value - this.target, estimate.value, now);
        }
        return before !== `${this.active}:${this.rate.toFixed(4)}`;
    }

    // ------------------------------------------------------------- internals

    private blank(reason: CorrectionState['reason']): CorrectionState {
        return {
            active: this.active,
            rate: this.rate,
            lateness: null,
            error: null,
            locked: this.locked,
            reason,
        };
    }

    private stop(): void {
        this.active = null;
        this.rate = 0;
    }

    /** Folds the slope applied since the last call into the running integral. */
    private advance(now: number): void {
        if (now > this.cumAt) {
            this.cum += this.slope() * ((now - this.cumAt) / 1000);
            this.cumAt = now;
        }
    }

    /**
     * dLateness/dt: slowing the picture lowers it, slowing the sound raises it.
     * A session slowed by `rate` runs at 1 / (1 + rate), so the gap moves by
     * rate / (1 + rate) per second, not by `rate` (6 % slower closes 5.66 %).
     */
    private slope(): number {
        if (this.active === null) return 0;
        const closing = (this.rate / (1 + this.rate)) * this.speedScale;
        return this.active === 'main' ? -closing : closing;
    }

    private trim(now: number): void {
        const { windowMs, manualHorizonMs, manualMaxMs } = this.config;
        this.readings = this.readings.filter((r) => {
            const age = now - r.at;
            if (!r.manual) return age <= windowMs;
            // Steering on it: it stays until the gap is closed (or the cap).
            return age <= (this.active !== null ? manualMaxMs : manualHorizonMs);
        });
    }

    private estimate(): {
        value: number | null;
        reason: CorrectionState['reason'];
    } {
        if (this.readings.length === 0) return { value: null, reason: 'none' };
        const manual = this.readings.find((r) => r.manual);
        const compensated = this.readings.map(
            (r) => r.value + (this.cum - r.cum)
        );
        if (manual && this.readings.length === 1) {
            return { value: compensated[0], reason: 'ok' };
        }
        if (this.readings.length < this.config.minReadings) {
            return { value: null, reason: 'none' };
        }
        const m = median(compensated);
        const mad = median(compensated.map((v) => Math.abs(v - m)));
        if (mad > this.config.madLimitSeconds) {
            return { value: null, reason: 'noisy' };
        }
        return { value: m, reason: 'ok' };
    }

    private decide(error: number, lateness: number, now: number): void {
        const { enterSeconds, exitSeconds, tcSeconds, minRate } = this.config;
        // The lock is a pause for an unstable stretch, not a verdict for the rest of the playback.
        if (this.locked && now - this.lockedAt >= this.config.lockWindowMs) {
            this.locked = false;
            this.flips = [];
            this.lastDirection = null;
        }
        let want: CorrectionTarget | null | 'none' = null;
        if (this.active === null) {
            if (Math.abs(error) > enterSeconds)
                want = error > 0 ? 'main' : 'sound';
        } else {
            const sameSide = error > 0 === (this.active === 'main');
            // Overshoot or inside the dead band: let go, never reverse at once.
            want =
                Math.abs(error) < exitSeconds || !sameSide
                    ? 'none'
                    : this.active;
        }
        if (want === 'none') {
            this.stop();
        } else if (want !== null && !this.locked) {
            if (this.lastDirection !== null && want !== this.lastDirection) {
                this.flips = this.flips.filter(
                    (t) => now - t < this.config.lockWindowMs
                );
                this.flips.push(now);
                if (this.flips.length >= this.config.maxFlips) {
                    this.locked = true;
                    this.lockedAt = now;
                }
            }
            if (!this.locked) {
                this.lastDirection = want;
                const cap =
                    want === 'main'
                        ? this.config.maxMainRate
                        : this.config.maxSoundRate;
                const rate = Math.min(
                    cap,
                    Math.max(minRate, Math.abs(error) / tcSeconds)
                );
                if (
                    want !== this.active ||
                    Math.abs(rate - this.rate) >= 0.003
                ) {
                    this.active = want;
                    this.rate = rate;
                }
            }
        }
        if (this.locked) this.stop();
        this.lastState = {
            active: this.active,
            rate: this.rate,
            lateness,
            error,
            locked: this.locked,
            reason: 'ok',
        };
    }
}
