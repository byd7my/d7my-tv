import {
    OCR_PASSES,
    recognizeClock,
    type OcrPass,
    type RawOcr,
} from './match-clock-ocr-passes';

const key = (pass: OcrPass) => `${pass.mode}${pass.flip ? '-flip' : ''}`;

function fake(answers: Record<string, RawOcr>) {
    const calls: string[] = [];
    const run = async (pass: OcrPass): Promise<RawOcr> => {
        calls.push(key(pass));
        return answers[key(pass)] ?? { text: '', confidence: 0 };
    };
    return { run, calls };
}

describe('recognizeClock', () => {
    it('stops at the first way that reads a clock and keeps the engine confidence', async () => {
        const { run, calls } = fake({
            line: { text: '47:19', confidence: 88 },
        });
        const { reading, pass } = await recognizeClock(run, null);
        expect(reading).toEqual({ text: '47:19', confidence: 88 });
        expect(pass).toEqual(OCR_PASSES[0]);
        expect(calls).toEqual(['line']);
    });

    it('searches the whole scoreboard when the line read is garbage', async () => {
        const { run, calls } = fake({
            line: { text: '0 4 7 1 9 0', confidence: 40 },
            sparse: { text: '0\n47:19\n0\n+5', confidence: 30 },
        });
        const { reading, pass } = await recognizeClock(run, null);
        // Found among other text: the engine average says nothing about it.
        expect(reading).toEqual({ text: '47:19', confidence: 70 });
        expect(pass).toEqual({ mode: 'sparse', flip: false });
        expect(calls).toEqual(['line', 'sparse']);
    });

    it('turns the light/dark guess around when the clock sits in a light box', async () => {
        const { run, calls } = fake({
            'sparse-flip': { text: '47:19\n+5', confidence: 20 },
        });
        const { reading } = await recognizeClock(run, null);
        expect(reading.text).toBe('47:19');
        expect(calls).toEqual(['line', 'sparse', 'sparse-flip']);
    });

    it('tries the way that worked last time first', async () => {
        const { run, calls } = fake({
            'sparse-flip': { text: '47:20', confidence: 0 },
        });
        const preferred: OcrPass = { mode: 'sparse', flip: true };
        const { pass } = await recognizeClock(run, preferred);
        expect(pass).toEqual(preferred);
        expect(calls).toEqual(['sparse-flip']);
    });

    it('returns the first reading as it came when no way finds a clock', async () => {
        const { run, calls } = fake({
            line: { text: '3-1', confidence: 0 },
            sparse: { text: '0\n0', confidence: 0 },
        });
        const { reading, pass } = await recognizeClock(run, null);
        expect(reading).toEqual({ text: '3-1', confidence: 0 });
        expect(pass).toBeNull();
        expect(calls).toHaveLength(OCR_PASSES.length);
    });
});
