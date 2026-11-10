/**
 * Pure helpers for the OCR match clock: parse what the scoreboard shows,
 * reject readings that are clearly not a match clock, and keep a smooth
 * running clock between (noisy, once-a-second) OCR readings.
 */

export interface MatchClockReading {
    /** Match time in whole seconds, stoppage time folded in (45+2 → 47:00). */
    seconds: number;
    /** True when the scoreboard shows stoppage time ("45+2"). */
    stoppage: boolean;
}

/** Longest believable match clock: extra time plus stoppage. */
const MAX_MATCH_SECONDS = 130 * 60;

/**
 * Parses "12:34", "9:05", "45+2", "90+3:10". Anything with three
 * colon-separated groups (HH:MM:SS) is a stream/system clock, not a match
 * clock, and is rejected.
 */
export function parseMatchClock(raw: string): MatchClockReading | null {
    const text = raw.replace(/\s+/g, '').replace(/[.,;]/g, ':');
    if (!text || (text.match(/:/g)?.length ?? 0) > 1) return null;

    const plus = /^(\d{1,3})\+(\d{1,2})(?::(\d{2}))?$/.exec(text);
    if (plus) {
        const base = Number(plus[1]) * 60;
        const extra = Number(plus[2]) * 60 + Number(plus[3] ?? 0);
        return validated(base + extra, true);
    }

    const plain = /^(\d{1,3}):(\d{2})$/.exec(text);
    if (!plain) return null;
    const seconds = Number(plain[2]);
    if (seconds > 59) return null;
    return validated(Number(plain[1]) * 60 + seconds, false);
}

function validated(
    seconds: number,
    stoppage: boolean
): MatchClockReading | null {
    return seconds >= 0 && seconds <= MAX_MATCH_SECONDS
        ? { seconds, stoppage }
        : null;
}

export function formatMatchClock(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "12:34" typed by the user (manual correction). */
export function parseManualClock(raw: string): number | null {
    const reading = parseMatchClock(raw.trim());
    return reading ? reading.seconds : null;
}

/**
 * True when the text equals the local or UTC wall-clock hour:minute, which
 * is the usual sign that the region covers a system/stream clock.
 */
export function matchesWallClock(
    reading: MatchClockReading,
    now: Date
): boolean {
    const minutes = Math.floor(reading.seconds / 60);
    const seconds = reading.seconds % 60;
    const candidates = [
        [now.getHours(), now.getMinutes()],
        [now.getUTCHours(), now.getUTCMinutes()],
    ];
    return candidates.some(
        ([h, m]) => minutes === h && Math.abs(seconds - m) < 1
    );
}

export type MatchClockTrust = 'high' | 'medium' | 'low';

export interface MatchClockState {
    seconds: number;
    trust: MatchClockTrust;
    confidence: number;
    manual: boolean;
}

const CONFIRMATIONS_NEEDED = 2;
/** Allowed gap between the running clock and a new reading. */
const TOLERANCE_SECONDS = 3;
const MIN_CONFIDENCE = 55;
const STREAK_CAP = 10;
const STREAK_BONUS = 2;

/**
 * Keeps a running clock anchored on accepted readings. A reading is
 * accepted when it agrees with the running clock; a reading that disagrees
 * must repeat consistently before the clock jumps to it (so one misread
 * digit never moves the clock). `now` is injected for tests.
 */
export class MatchClockTracker {
    private anchorSeconds: number | null = null;
    private anchorAt = 0;
    private lastConfidence = 0;
    private manual = false;
    /** Consecutive readings that agreed with the running clock. */
    private streak = 0;
    private pending: { seconds: number; at: number; count: number } | null =
        null;
    private running = true;

    setRunning(running: boolean, now: number): void {
        if (this.running === running) return;
        if (this.anchorSeconds !== null) {
            this.anchorSeconds = this.currentSeconds(now) ?? this.anchorSeconds;
            this.anchorAt = now;
        }
        this.running = running;
    }

    reset(): void {
        this.anchorSeconds = null;
        this.pending = null;
        this.manual = false;
        this.streak = 0;
        this.lastConfidence = 0;
    }

    /** User typed the correct time: trust it until OCR agrees repeatedly. */
    setManual(seconds: number, now: number): void {
        this.anchorSeconds = seconds;
        this.anchorAt = now;
        this.manual = true;
        this.pending = null;
        this.streak = 0;
        this.lastConfidence = 100;
    }

    /** Feeds one OCR reading. Returns true when the clock changed. */
    ingest(
        reading: MatchClockReading | null,
        confidence: number,
        now: number
    ): boolean {
        if (!reading || confidence < MIN_CONFIDENCE) return false;
        const current = this.currentSeconds(now);
        if (current !== null) {
            const drift = Math.abs(reading.seconds - current);
            if (drift <= TOLERANCE_SECONDS) {
                // Every reading that agrees with the running clock makes the
                // next one more believable (engines often report no
                // confidence of their own for a digit-only line).
                this.streak = Math.min(STREAK_CAP, this.streak + 1);
                this.accept(
                    reading.seconds,
                    Math.min(98, confidence + this.streak * STREAK_BONUS),
                    now
                );
                this.pending = null;
                return true;
            }
        }
        const pending = this.pending;
        const expected = pending
            ? pending.seconds + (now - pending.at) / 1000
            : 0;
        if (pending && Math.abs(reading.seconds - expected) <= TOLERANCE_SECONDS) {
            pending.count += 1;
            if (pending.count >= CONFIRMATIONS_NEEDED) {
                this.streak = 0;
                this.accept(reading.seconds, confidence, now);
                this.manual = false;
                this.pending = null;
                return true;
            }
            return false;
        }
        this.pending = { seconds: reading.seconds, at: now, count: 1 };
        return false;
    }

    currentSeconds(now: number): number | null {
        if (this.anchorSeconds === null) return null;
        if (!this.running) return this.anchorSeconds;
        return this.anchorSeconds + Math.max(0, now - this.anchorAt) / 1000;
    }

    snapshot(now: number): MatchClockState | null {
        const seconds = this.currentSeconds(now);
        if (seconds === null) return null;
        const trust: MatchClockTrust = this.manual
            ? 'medium'
            : this.lastConfidence >= 80
              ? 'high'
              : this.lastConfidence >= MIN_CONFIDENCE + 15
                ? 'medium'
                : 'low';
        return {
            seconds,
            trust,
            confidence: Math.round(this.lastConfidence),
            manual: this.manual,
        };
    }

    private accept(seconds: number, confidence: number, now: number): void {
        this.anchorSeconds = seconds;
        this.anchorAt = now;
        this.lastConfidence = confidence;
        this.manual = false;
    }
}
