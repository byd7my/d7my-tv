import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ExternalAudioOverride } from '@iptvnator/shared/interfaces';
import { AudioSyncController } from './audio-sync.controller';

const REGION = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 };

function frame(ageMs = 0) {
    return { width: 4, height: 2, data: new Uint8ClampedArray(32), ageMs, seq: 1 };
}

function memoryStorage() {
    const data = new Map<string, string>();
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
    };
}

describe('AudioSyncController', () => {
    let clockMs: number;
    let texts: { main: string; audio: string };
    let api: ReturnType<typeof createApi>;
    const audio = signal<ExternalAudioOverride | null>({
        streamUrl: 'http://audio/1',
        delaySeconds: 0,
    } as ExternalAudioOverride);
    const setDelay = jest.fn();

    function createApi() {
        return {
            createEmbeddedMpvPreviewSession: jest
                .fn()
                .mockResolvedValue({ id: 'preview-1' }),
            attachEmbeddedMpvFrameView: jest.fn().mockResolvedValue(true),
            detachEmbeddedMpvFrameView: jest.fn(),
            loadEmbeddedMpvPlayback: jest.fn().mockResolvedValue(undefined),
            disposeEmbeddedMpvSession: jest.fn().mockResolvedValue(null),
            onEmbeddedMpvSessionUpdate: jest.fn().mockReturnValue(() => undefined),
            captureEmbeddedMpvFrame: jest.fn((role: string) =>
                role === 'main' ? frame() : frame()
            ),
        };
    }

    function build(storage = memoryStorage()) {
        let controller!: AudioSyncController;
        let ocrCalls = 0;
        TestBed.runInInjectionContext(() => {
            controller = new AudioSyncController({
                api: () => api,
                audio,
                videoUrl: signal('http://video/1'),
                setDelay,
                clampDelay: (value) => Math.max(-10, Math.min(10, value)),
                toPlayback: (a) => ({
                    streamUrl: a.streamUrl,
                    title: '',
                    isLive: true,
                }),
                ocr: {
                    recognize: jest.fn(async () => {
                        // Alternates main, audio each OCR round.
                        const text = ocrCalls++ % 2 === 0 ? texts.main : texts.audio;
                        return { text, confidence: 92 };
                    }),
                    dispose: jest.fn().mockResolvedValue(undefined),
                },
                storage,
                now: () => clockMs,
            });
        });
        return controller;
    }

    async function advanceSeconds(seconds: number): Promise<void> {
        for (let i = 0; i < seconds * 4; i++) {
            clockMs += 250;
            jest.advanceTimersByTime(250);
            await Promise.resolve();
            await Promise.resolve();
        }
    }

    beforeEach(() => {
        // The frame-copy player's canvas: its presence marks the engine.
        const canvas = document.createElement('canvas');
        canvas.setAttribute('data-embedded-mpv-frame', '');
        document.body.appendChild(canvas);
        jest.useFakeTimers();
        clockMs = 0;
        texts = { main: '10:00', audio: '10:04' };
        api = createApi();
        setDelay.mockReset();
        audio.set({ streamUrl: 'http://audio/1', delaySeconds: 0 } as ExternalAudioOverride);
    });

    afterEach(() => {
        document.querySelector('canvas[data-embedded-mpv-frame]')?.remove();
        jest.useRealTimers();
    });

    it('asks for the scoreboard regions before reading anything', async () => {
        const controller = build();

        controller.open();
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.mode()).toBe('pick');
        expect(controller.pickSource()).toBe('audio');
        // The picker needs the whole audio picture, so no crop is requested.
        expect(
            api.createEmbeddedMpvPreviewSession.mock.calls[0][0].region
        ).toBeUndefined();
        controller.close();
    });

    it('moves on to the main picture, then goes live with a cropped preview', async () => {
        const controller = build();
        controller.open();
        await Promise.resolve();

        controller.confirmRegion(REGION);
        expect(controller.pickSource()).toBe('main');
        controller.confirmRegion({ ...REGION, y: 0.5 });
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.mode()).toBe('live');
        const lastCall = api.createEmbeddedMpvPreviewSession.mock.calls.at(-1)[0];
        expect(lastCall.region).toEqual(REGION);
        controller.close();
    });

    it('reads both clocks and suggests delaying the audio that is ahead', async () => {
        const storage = memoryStorage();
        const first = build(storage);
        first.open();
        await Promise.resolve();
        first.confirmRegion(REGION);
        first.confirmRegion(REGION);
        first.close();

        const controller = build(storage);
        controller.open();
        await Promise.resolve();
        await Promise.resolve();
        expect(controller.mode()).toBe('live');

        // The clocks keep running, one second per second.
        api.captureEmbeddedMpvFrame.mockImplementation(() => frame());
        const ocr = (controller as unknown as { options: { ocr: { recognize: jest.Mock } } })
            .options.ocr.recognize;
        ocr.mockImplementation(async () => {
            const main = 600 + Math.floor(clockMs / 1000);
            const audioSeconds = main + 4;
            const fmt = (value: number) =>
                `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
            // OCR is called main first, then audio.
            return ocr.mock.calls.length % 2 === 1
                ? { text: fmt(main), confidence: 92 }
                : { text: fmt(audioSeconds), confidence: 92 };
        });

        await advanceSeconds(12);

        expect(controller.main().live).toBe(true);
        expect(controller.audioReadout().live).toBe(true);
        expect(controller.offset()).not.toBeNull();
        expect(Math.round(controller.offset() as number)).toBe(4);
        expect(controller.suggestion()?.direction).toBe('delayAudio');

        controller.applySuggestion();
        expect(setDelay).toHaveBeenCalledWith(4);
        controller.close();
    });

    it('never shows a frozen picture as live', async () => {
        const storage = memoryStorage();
        const first = build(storage);
        first.open();
        await Promise.resolve();
        first.confirmRegion(REGION);
        first.confirmRegion(REGION);
        first.close();

        const controller = build(storage);
        controller.open();
        await Promise.resolve();
        await Promise.resolve();
        api.captureEmbeddedMpvFrame.mockImplementation((role: string) =>
            role === 'preview' ? frame(9000) : frame()
        );

        await advanceSeconds(2);

        expect(controller.audioReadout().live).toBe(false);
        expect(controller.audioReadout().problem).toBe('stale');
        expect(controller.audioReadout().text).toBeNull();
        expect(controller.offset()).toBeNull();
        controller.close();
    });

    it('fails clearly when the preview session cannot start', async () => {
        api.createEmbeddedMpvPreviewSession.mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const controller = build();

        controller.open();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.previewStatus()).toBe('failed');
        expect(controller.audioReadout().problem).toBe('failed');
        controller.close();
    });

    it('closes the preview session and leaves the main one alone', async () => {
        const controller = build();
        controller.open();
        await Promise.resolve();
        await Promise.resolve();

        controller.close();
        await Promise.resolve();
        await Promise.resolve();

        expect(api.detachEmbeddedMpvFrameView).toHaveBeenCalledWith('preview');
        expect(api.disposeEmbeddedMpvSession).toHaveBeenCalledWith('preview-1');
        expect(api.detachEmbeddedMpvFrameView).not.toHaveBeenCalledWith('main');
        expect(api.disposeEmbeddedMpvSession).toHaveBeenCalledTimes(1);
    });

    it('is unavailable without the frame-copy engine canvas', () => {
        document.querySelector('canvas[data-embedded-mpv-frame]')?.remove();
        const controller = build();

        expect(controller.available()).toBe(false);
    });

    it('accepts a typed clock and rejects nonsense', () => {
        const controller = build();

        expect(controller.setManualClock('main', '23:10')).toBe(true);
        expect(controller.setManualClock('main', 'abc')).toBe(false);
    });
});
