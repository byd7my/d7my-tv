import { effectiveConfidence, tesseractApi } from './match-clock-ocr.service';

describe('effectiveConfidence', () => {
    it('keeps a confidence the engine reports', () => {
        expect(effectiveConfidence('87:43', 91)).toBe(91);
    });

    it('treats an engine 0 on a clock-shaped text as unknown, not wrong', () => {
        expect(effectiveConfidence('87:43', 0)).toBe(70);
        expect(effectiveConfidence('45+2', 0)).toBe(70);
        expect(effectiveConfidence('90+3:10', 0)).toBe(70);
    });

    it('gives nothing to text that is not a clock', () => {
        expect(effectiveConfidence('', 0)).toBe(0);
        expect(effectiveConfidence('3-1', 0)).toBe(0);
        expect(effectiveConfidence('12:34:56', 0)).toBe(0);
    });
});

describe('tesseractApi', () => {
    const createWorker = jest.fn();

    it('uses the exports of a module that exposes them directly', () => {
        expect(tesseractApi({ createWorker }).createWorker).toBe(createWorker);
    });

    it('finds them under default when the bundler nests CommonJS exports', () => {
        expect(
            tesseractApi({ default: { createWorker } }).createWorker
        ).toBe(createWorker);
    });

    it('says so when the engine is missing', () => {
        expect(() => tesseractApi({})).toThrow('createWorker');
    });
});
