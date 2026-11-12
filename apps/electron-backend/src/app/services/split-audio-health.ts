/**
 * Watches the SOUND session while it is being slowed down. What is heard is
 * what the user judges, so the check is on the sound's own clock: does the
 * position advance at the speed that was asked for, is the buffer full, are
 * frames being dropped? A stall, a starved buffer or a speed that mpv does not
 * follow is what a listener hears as a gap, a stutter or a wobble.
 *
 * Pure: it only sees samples. The pair decides what to do with the verdicts.
 */
export type AudioIssue = 'stall' | 'starving' | 'rate' | 'drops';

export interface HealthSample {
    now: number;
    status: string;
    /** mpv's position of the sound session, seconds (fractional). */
    positionSeconds: number;
    /** Speed commanded to the sound session right now. */
    speed: number;
    bufferedAheadSeconds: number | null;
    droppedFrames: number | null;
    /** The user paused: no movement is expected. */
    userPaused: boolean;
    /** Seconds since the speed last changed (rate checks need a steady speed). */
    steadySeconds: number;
}

export interface HealthConfig {
    stallWindowMs: number;
    /** Below this share of the expected advance counts as a stall. */
    stallRatio: number;
    starveBelowSeconds: number;
    starveForMs: number;
    rateWindowMs: number;
    /** Relative error of the measured rate that counts as a mismatch. */
    rateTolerance: number;
    dropWindowMs: number;
    dropLimit: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
    stallWindowMs: 2500,
    stallRatio: 0.2,
    starveBelowSeconds: 0.25,
    starveForMs: 3000,
    // The sound session's position moves in quarter-second steps, so a rate over a short window is only good to about +-2%
    // (measured on a real Windows helper). 24 s brings that to under 1%, and 2% still catches a speed mpv ignores (3% or more).
    rateWindowMs: 24000,
    rateTolerance: 0.02,
    dropWindowMs: 5000,
    dropLimit: 10,
};

export interface HealthVerdict {
    issue: AudioIssue | null;
    /** Position advance per wall second over the rate window; null if unknown. */
    measuredRate: number | null;
}

export class AudioHealthMonitor {
    private samples: HealthSample[] = [];
    private starvingSince: number | null = null;

    constructor(
        private readonly config: HealthConfig = DEFAULT_HEALTH_CONFIG
    ) {}

    /** Forget everything (pause, seek, reload: positions are not comparable). */
    reset(): void {
        this.samples = [];
        this.starvingSince = null;
    }

    observe(sample: HealthSample): HealthVerdict {
        const { config } = this;
        // Only a playing, unpaused session says anything about its sound.
        if (sample.status !== 'playing' || sample.userPaused) {
            this.reset();
            return { issue: null, measuredRate: null };
        }
        this.samples.push(sample);
        const horizon = Math.max(
            config.rateWindowMs,
            config.stallWindowMs,
            config.dropWindowMs
        );
        this.samples = this.samples.filter(
            (s) => sample.now - s.now <= horizon
        );
        // A jump back or forward is a seek or reload, not a stall.
        const previous = this.samples[this.samples.length - 2];
        if (
            previous &&
            Math.abs(sample.positionSeconds - previous.positionSeconds) > 5
        ) {
            this.samples = [sample];
            this.starvingSince = null;
            return { issue: null, measuredRate: null };
        }

        const measuredRate = this.rateOver(config.rateWindowMs, sample);

        const stall = this.advanceRatio(config.stallWindowMs, sample);
        if (stall !== null && stall < config.stallRatio) {
            return { issue: 'stall', measuredRate };
        }

        const buffered = sample.bufferedAheadSeconds;
        if (buffered !== null && buffered < config.starveBelowSeconds) {
            this.starvingSince ??= sample.now;
            if (sample.now - this.starvingSince >= config.starveForMs) {
                return { issue: 'starving', measuredRate };
            }
        } else {
            this.starvingSince = null;
        }

        const dropped = this.droppedOver(config.dropWindowMs, sample);
        if (dropped >= config.dropLimit)
            return { issue: 'drops', measuredRate };

        if (
            measuredRate !== null &&
            sample.steadySeconds * 1000 >= config.rateWindowMs &&
            Math.abs(measuredRate - sample.speed) / sample.speed >
                config.rateTolerance
        ) {
            return { issue: 'rate', measuredRate };
        }
        return { issue: null, measuredRate };
    }

    private oldest(
        windowMs: number,
        sample: HealthSample
    ): HealthSample | null {
        const found = this.samples.find((s) => sample.now - s.now <= windowMs);
        return found && found !== sample ? found : null;
    }

    /**
     * Advance of the position per wall second over the window, as the slope of
     * a least-squares line. The sound session's position moves in steps (the
     * hidden picture runs at a few frames a second, so mpv's position only
     * changes per frame): two end points could be off by a whole step, a
     * fitted line is not.
     */
    private rateOver(windowMs: number, sample: HealthSample): number | null {
        const points = this.samples.filter(
            (s) => sample.now - s.now <= windowMs
        );
        const first = points[0];
        if (!first || sample.now - first.now < windowMs * 0.8) return null;
        const n = points.length;
        if (n < 4) return null;
        const mx = points.reduce((a, p) => a + p.now / 1000, 0) / n;
        const my = points.reduce((a, p) => a + p.positionSeconds, 0) / n;
        let num = 0;
        let den = 0;
        for (const p of points) {
            num += (p.now / 1000 - mx) * (p.positionSeconds - my);
            den += (p.now / 1000 - mx) ** 2;
        }
        return den > 0 ? num / den : null;
    }

    /** Measured advance divided by the advance the commanded speed predicts. */
    private advanceRatio(
        windowMs: number,
        sample: HealthSample
    ): number | null {
        const first = this.oldest(windowMs, sample);
        if (!first || sample.now - first.now < windowMs * 0.8) return null;
        const seconds = (sample.now - first.now) / 1000;
        return (
            (sample.positionSeconds - first.positionSeconds) /
            (seconds * sample.speed)
        );
    }

    private droppedOver(windowMs: number, sample: HealthSample): number {
        const first = this.oldest(windowMs, sample);
        if (
            !first ||
            first.droppedFrames === null ||
            sample.droppedFrames === null
        )
            return 0;
        return Math.max(0, sample.droppedFrames - first.droppedFrames);
    }
}

/**
 * What to do about verdicts: let go of the correction on the first one, and
 * give the external sound up when a second one follows within the window.
 */
export interface IssuePolicyConfig {
    /** Issues inside this window count towards giving up (5 minutes). */
    windowMs: number;
    maxIssues: number;
    /** Seconds the correction stays released after an issue. */
    holdMs: number;
}

export const DEFAULT_ISSUE_POLICY: IssuePolicyConfig = {
    windowMs: 300000,
    maxIssues: 2,
    holdMs: 20000,
};

export type IssueAction = 'release' | 'give-up';

export class AudioIssuePolicy {
    private times: number[] = [];

    constructor(
        private readonly config: IssuePolicyConfig = DEFAULT_ISSUE_POLICY
    ) {}

    get holdMs(): number {
        return this.config.holdMs;
    }

    /** Every reliable issue counts, whichever session is the slowed one. */
    onIssue(now: number): IssueAction {
        this.times = this.times.filter((t) => now - t < this.config.windowMs);
        this.times.push(now);
        return this.times.length >= this.config.maxIssues
            ? 'give-up'
            : 'release';
    }

    reset(): void {
        this.times = [];
    }
}
