import { parseMatchClock } from './match-clock.util';

/** "47:19": minutes, a colon, two digits of seconds; "12:34:56" (a stream clock) is not one. */
const COLON_CLOCK = /(?<![\d:])(\d{1,3})\s?:\s?(\d{2})(?!\d|:\d)/g;
/** "90+3": the base minute and the added time, on one line. */
const PLUS_CLOCK = /(?<!\d)(\d{1,3})\s?\+\s?(\d{1,2})(?!\d)/g;
/** A stoppage clock only starts from a half or an extra-time boundary. */
const MIN_PLUS_BASE = 40;

/** Every match of a global pattern in a line (`matchAll` is not in the build's lib). */
function matchesIn(pattern: RegExp, line: string): RegExpExecArray[] {
    const found: RegExpExecArray[] = [];
    const regex = new RegExp(pattern.source, 'g');
    for (let m = regex.exec(line); m; m = regex.exec(line)) found.push(m);
    return found;
}

/**
 * Finds the match clock inside what the OCR read from a bigger area, where
 * the clock is one line among scores, team names and "+5" added time. The
 * clock with a colon wins; "45+2" is the fallback. Returns the clock in the
 * shape `parseMatchClock` takes, or null when the text holds none.
 */
export function findClockInText(text: string): string | null {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        for (const match of matchesIn(COLON_CLOCK, line)) {
            const clock = `${match[1]}:${match[2]}`;
            if (parseMatchClock(clock)) return clock;
        }
    }
    for (const line of lines) {
        for (const match of matchesIn(PLUS_CLOCK, line)) {
            if (Number(match[1]) < MIN_PLUS_BASE) continue;
            const clock = `${match[1]}+${match[2]}`;
            if (parseMatchClock(clock)) return clock;
        }
    }
    return null;
}
