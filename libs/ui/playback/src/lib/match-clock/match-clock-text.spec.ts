import { findClockInText } from './match-clock-text';

describe('findClockInText', () => {
    it('takes the clock out of a whole scoreboard read as several lines', () => {
        expect(findClockInText('0\n47:19\n0\n+5')).toBe('47:19');
        expect(findClockInText('EIB 0\n47:19 MGA 0\n+5')).toBe('47:19');
    });

    it('accepts a clock that is alone, with stray spaces', () => {
        expect(findClockInText('87:43')).toBe('87:43');
        expect(findClockInText(' 9 : 05 ')).toBe('9:05');
    });

    it('does not take the added time or a score for the clock', () => {
        expect(findClockInText('+5')).toBeNull();
        expect(findClockInText('0\n0\n+5')).toBeNull();
        expect(findClockInText('3-1')).toBeNull();
        expect(findClockInText('0 +5')).toBeNull();
    });

    it('rejects seconds above 59 and stream clocks', () => {
        expect(findClockInText('47:75')).toBeNull();
        expect(findClockInText('12:34:56')).toBeNull();
    });

    it('falls back to a stoppage clock only from a half boundary', () => {
        expect(findClockInText('90+3')).toBe('90+3');
        expect(findClockInText('45 + 2')).toBe('45+2');
        expect(findClockInText('2+3')).toBeNull();
    });

    it('prefers the colon clock when both are there', () => {
        expect(findClockInText('90+3\n93:10')).toBe('93:10');
    });

    it('finds nothing in empty text', () => {
        expect(findClockInText('')).toBeNull();
    });
});
