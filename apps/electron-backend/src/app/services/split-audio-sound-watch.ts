import type { SoundSnapshot } from './embedded-mpv-split-audio';
import {
    AudioHealthMonitor,
    AudioIssuePolicy,
    type AudioIssue,
} from './split-audio-health';

/** How long the last fault stays in the status (display only). */
export const ISSUE_SHOWN_MS = 30000;
/** The sound has to advance this long before a new fault is a new incident. */
const RECOVERED_AFTER_MS = 3000;

export interface WatchSample {
    now: number;
    /** The speed the sound session was asked for. */
    speed: number;
    /** The user (or the sync freeze) holds the sound still on purpose. */
    held: boolean;
    userPaused: boolean;
    steadySeconds: number;
}

/**
 * Watches the sound session while it is slowed or frozen: stall, starved
 * buffer, a speed mpv does not follow, dropped frames. One continuous fault is
 * one incident, reported once, until the sound has moved on for a while.
 */
export class SoundWatch {
    readonly policy = new AudioIssuePolicy();
    private readonly health = new AudioHealthMonitor();
    issue: AudioIssue | null = null;
    issueAt = 0;
    audioRate: number | null = null;
    private incident = false;
    private lastPosition = NaN;
    private lastMoveAt = 0;
    private movingSince: number | null = null;

    reset(): void {
        this.health.reset();
        this.issue = null;
        this.incident = false;
        this.movingSince = null;
        this.audioRate = null;
    }

    /** The last fault, while it is still worth showing. */
    shownIssue(now: number): AudioIssue | null {
        return this.issue && now - this.issueAt < ISSUE_SHOWN_MS
            ? this.issue
            : null;
    }

    /** Returns the fault when this sample starts a new incident, else null. */
    observe(snap: SoundSnapshot, s: WatchSample): AudioIssue | null {
        const verdict = this.health.observe({
            now: s.now,
            status: snap.status,
            positionSeconds: snap.positionSeconds,
            speed: s.speed,
            bufferedAheadSeconds: snap.bufferedAheadSeconds,
            droppedFrames: snap.droppedFrames,
            userPaused: s.userPaused || s.held,
            steadySeconds: s.steadySeconds,
        });
        this.audioRate = verdict.measuredRate;
        this.trackMotion(snap, s);
        if (this.incident) {
            if (
                !verdict.issue &&
                this.movingSince !== null &&
                s.now - this.movingSince >= RECOVERED_AFTER_MS
            ) {
                this.incident = false;
            }
            return null;
        }
        if (!verdict.issue) return null;
        this.incident = true;
        this.issue = verdict.issue;
        this.issueAt = s.now;
        return verdict.issue;
    }

    /** What was measured no longer holds: start over. */
    clearHealth(): void {
        this.health.reset();
    }

    private trackMotion(snap: SoundSnapshot, s: WatchSample): void {
        if (snap.status !== 'playing' || s.userPaused) {
            this.movingSince = null;
            return;
        }
        if (snap.positionSeconds !== this.lastPosition) {
            this.lastPosition = snap.positionSeconds;
            this.lastMoveAt = s.now;
        }
        if (s.now - this.lastMoveAt <= 1000) this.movingSince ??= s.now;
        else this.movingSince = null;
    }
}
