import {
    formatMatchClock,
    matchesWallClock,
    MatchClockTracker,
    parseManualClock,
    parseMatchClock,
} from './match-clock.util';

describe('parseMatchClock', () => {
    it('parses plain minutes and seconds', () => {
        expect(parseMatchClock('12:34')).toEqual({
            seconds: 754,
            stoppage: false,
        });
        expect(parseMatchClock(' 9:05 ')?.seconds).toBe(545);
        expect(parseMatchClock('90:00')?.seconds).toBe(5400);
    });

    it('parses stoppage time', () => {
        expect(parseMatchClock('45+2')).toEqual({
            seconds: 47 * 60,
            stoppage: true,
        });
        expect(parseMatchClock('90+3:10')?.seconds).toBe(93 * 60 + 10);
    });

    it('tolerates OCR punctuation noise', () => {
        expect(parseMatchClock('12.34')?.seconds).toBe(754);
    });

    it('rejects stream or system clocks and garbage', () => {
        expect(parseMatchClock('12:34:56')).toBeNull();
        expect(parseMatchClock('12:75')).toBeNull();
        expect(parseMatchClock('abc')).toBeNull();
        expect(parseMatchClock('')).toBeNull();
        expect(parseMatchClock('999:00')).toBeNull();
    });
});

describe('formatting and manual input', () => {
    it('formats whole minutes past 99', () => {
        expect(formatMatchClock(61)).toBe('01:01');
        expect(formatMatchClock(6005)).toBe('100:05');
    });

    it('parses a manual correction', () => {
        expect(parseManualClock('23:10')).toBe(1390);
        expect(parseManualClock('x')).toBeNull();
    });
});

describe('matchesWallClock', () => {
    it('flags a reading equal to the local hour:minute', () => {
        const now = new Date(2026, 0, 1, 21, 45, 0);
        expect(matchesWallClock({ seconds: 21 * 60 + 45, stoppage: false }, now)).toBe(
            true
        );
        expect(matchesWallClock({ seconds: 12 * 60 + 5, stoppage: false }, now)).toBe(
            false
        );
    });
});

describe('MatchClockTracker', () => {
    const reading = (seconds: number) => ({ seconds, stoppage: false });

    it('runs smoothly between readings', () => {
        const tracker = new MatchClockTracker();
        tracker.ingest(reading(600), 90, 0);
        // First reading has no running clock to compare against, so it is pending.
        tracker.ingest(reading(601), 90, 1000);
        expect(tracker.currentSeconds(1000)).toBeCloseTo(601, 0);
        expect(tracker.currentSeconds(3500)).toBeCloseTo(603.5, 1);
    });

    it('ignores a single misread digit', () => {
        const tracker = new MatchClockTracker();
        tracker.ingest(reading(600), 90, 0);
        tracker.ingest(reading(601), 90, 1000);
        tracker.ingest(reading(1900), 90, 2000);
        expect(tracker.currentSeconds(2000)).toBeCloseTo(602, 0);
    });

    it('jumps after repeated consistent readings', () => {
        const tracker = new MatchClockTracker();
        tracker.ingest(reading(600), 90, 0);
        tracker.ingest(reading(601), 90, 1000);
        tracker.ingest(reading(1800), 90, 2000);
        tracker.ingest(reading(1801), 90, 3000);
        expect(tracker.currentSeconds(3000)).toBeCloseTo(1801, 0);
    });

    it('ignores low-confidence readings', () => {
        const tracker = new MatchClockTracker();
        expect(tracker.ingest(reading(600), 20, 0)).toBe(false);
        expect(tracker.currentSeconds(0)).toBeNull();
    });

    it('freezes while the stream is paused', () => {
        const tracker = new MatchClockTracker();
        tracker.ingest(reading(600), 90, 0);
        tracker.ingest(reading(601), 90, 1000);
        tracker.setRunning(false, 2000);
        expect(tracker.currentSeconds(9000)).toBeCloseTo(602, 0);
        tracker.setRunning(true, 9000);
        expect(tracker.currentSeconds(10000)).toBeCloseTo(603, 0);
    });

    it('keeps a manual correction until OCR repeatedly disagrees', () => {
        const tracker = new MatchClockTracker();
        tracker.setManual(1390, 0);
        expect(tracker.snapshot(0)?.manual).toBe(true);
        tracker.ingest(reading(1391), 90, 1000);
        expect(tracker.snapshot(1000)?.manual).toBe(false);
    });

    it('grows trust with every reading that agrees with the clock', () => {
        const tracker = new MatchClockTracker();
        tracker.ingest(reading(600), 70, 0);
        tracker.ingest(reading(601), 70, 1000);
        const early = tracker.snapshot(1000)?.confidence ?? 0;
        for (let i = 2; i < 12; i++) {
            tracker.ingest(reading(600 + i), 70, i * 1000);
        }

        expect(tracker.snapshot(11000)?.confidence).toBeGreaterThan(early);
        expect(tracker.snapshot(11000)?.trust).toBe('high');
    });
});
