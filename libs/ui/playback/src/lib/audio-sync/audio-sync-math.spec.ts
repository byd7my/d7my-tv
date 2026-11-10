import {
    OffsetSmoother,
    residualSeconds,
    suggestCorrection,
} from './audio-sync-math';

describe('audio sync maths', () => {
    it('the residual shrinks as the delay approaches the offset', () => {
        expect(residualSeconds(4, 0)).toBe(4);
        expect(residualSeconds(4, 3)).toBe(1);
        expect(residualSeconds(4, 4)).toBe(0);
    });

    it('delays the audio when the audio channel is ahead', () => {
        const suggestion = suggestCorrection(4, 0);

        expect(suggestion).toEqual({
            direction: 'delayAudio',
            seconds: 4,
            targetDelay: 4,
        });
    });

    it('advances the audio when the delay overshoots', () => {
        const suggestion = suggestCorrection(2, 5);

        expect(suggestion.direction).toBe('advanceAudio');
        expect(suggestion.seconds).toBe(3);
        expect(suggestion.targetDelay).toBe(2);
    });

    it('is in sync within the tolerance', () => {
        expect(suggestCorrection(3.4, 3).direction).toBe('inSync');
        expect(suggestCorrection(-0.5, 0).seconds).toBe(0);
    });

    it('respects the delay limits', () => {
        const suggestion = suggestCorrection(50, 0, (value) =>
            Math.min(10, value)
        );

        expect(suggestion.targetDelay).toBe(10);
    });

    it('supports a negative target (picture behind the audio channel)', () => {
        expect(suggestCorrection(-3, 0).targetDelay).toBe(-3);
        expect(suggestCorrection(-3, 0).direction).toBe('advanceAudio');
    });
});

describe('OffsetSmoother', () => {
    it('stays silent until it has a few samples', () => {
        const smoother = new OffsetSmoother();
        smoother.push(3);
        smoother.push(3);

        expect(smoother.median).toBeNull();
    });

    it('ignores a single outlier', () => {
        const smoother = new OffsetSmoother();
        [3, 3, 3, 40, 3].forEach((value) => smoother.push(value));

        expect(smoother.median).toBe(3);
    });

    it('forgets old samples', () => {
        const smoother = new OffsetSmoother();
        for (let i = 0; i < 9; i++) smoother.push(3);
        for (let i = 0; i < 9; i++) smoother.push(7);

        expect(smoother.median).toBe(7);
        expect(smoother.size).toBe(9);
    });
});
