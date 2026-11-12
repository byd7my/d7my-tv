import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
    EmbeddedMpvSplitAudioStatus,
    ExternalAudioOverride,
} from '@iptvnator/shared/interfaces';
import { AudioSyncController } from './audio-sync.controller';
import type { SplitAudioBridge } from './audio-sync-split';
import { saveRegion } from './audio-sync-regions';
import { DEFAULT_CLOCK_REGION } from './audio-sync.model';

function frame() {
    return {
        width: 4,
        height: 2,
        data: new Uint8ClampedArray(32),
        ageMs: 0,
        seq: 1,
    };
}

function storageFor(view: string, withRegions = false) {
    const data = new Map<string, string>([
        ['iptvnator.audioSync.view.v3', view],
    ]);
    const store = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
    };
    if (withRegions) {
        saveRegion(store, 'http://video/1', { ...DEFAULT_CLOCK_REGION });
        saveRegion(store, 'http://audio/1', { ...DEFAULT_CLOCK_REGION });
    }
    return store;
}

const STATUS = {
    mode: 'dual-session',
    soundSessionId: 'sound-1',
    syncMode: 'auto',
    state: 'measuring',
    userSpeed: 1,
    mainSpeed: 1,
    soundSpeed: 1,
    correcting: null,
    rate: 0,
    lateness: null,
    targetSeconds: 0.08,
    dBaseSeconds: 0.08,
    trimSeconds: 0,
    audioRate: null,
    issue: null,
    clockRegion: { ...DEFAULT_CLOCK_REGION },
} as EmbeddedMpvSplitAudioStatus;

describe('AudioSyncController on a two-session pair', () => {
    const audio = signal<ExternalAudioOverride | null>({
        streamUrl: 'http://audio/1',
        delaySeconds: 0,
    } as ExternalAudioOverride);
    let clockMs = 0;
    let api: Record<string, jest.Mock>;
    let bridge: SplitAudioBridge;
    let suspendAudio: jest.Mock;
    let setDelay: jest.Mock;

    function build(view = 'compare', withRegions = false) {
        let controller!: AudioSyncController;
        TestBed.runInInjectionContext(() => {
            controller = new AudioSyncController({
                api: () => api,
                audio,
                videoUrl: signal('http://video/1'),
                setDelay,
                suspendAudio,
                resumeAudio: jest.fn(),
                clampDelay: (v) => v,
                toPlayback: (a) => ({
                    streamUrl: a.streamUrl,
                    title: '',
                    isLive: true,
                }),
                ocr: {
                    recognize: jest.fn(async () => ({
                        text: '10:00',
                        confidence: 92,
                    })),
                    dispose: jest.fn().mockResolvedValue(undefined),
                },
                storage: storageFor(view, withRegions),
                now: () => clockMs,
                settleMs: 0,
                split: () => bridge,
            });
        });
        return controller;
    }

    async function advanceSeconds(seconds: number) {
        for (let i = 0; i < seconds * 4; i++) {
            clockMs += 250;
            jest.advanceTimersByTime(250);
            await Promise.resolve();
            await Promise.resolve();
        }
    }

    beforeEach(() => {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('data-embedded-mpv-frame', '');
        document.body.appendChild(canvas);
        jest.useFakeTimers();
        clockMs = 0;
        suspendAudio = jest.fn();
        setDelay = jest.fn();
        api = {
            createEmbeddedMpvPreviewSession: jest.fn(async () => ({
                id: 'preview-1',
            })),
            attachEmbeddedMpvFrameView: jest.fn().mockResolvedValue(true),
            detachEmbeddedMpvFrameView: jest.fn(),
            loadEmbeddedMpvPlayback: jest.fn().mockResolvedValue(undefined),
            disposeEmbeddedMpvSession: jest.fn().mockResolvedValue(null),
            onEmbeddedMpvSessionUpdate: jest
                .fn()
                .mockReturnValue(() => undefined),
            captureEmbeddedMpvFrame: jest.fn(() => frame()),
        };
        bridge = {
            enabled: () => true,
            status: () => STATUS,
            report: jest.fn(),
            reopen: jest.fn(),
        };
    });

    afterEach(() => {
        document.querySelector('canvas[data-embedded-mpv-frame]')?.remove();
        jest.useRealTimers();
    });

    it('opens on the sound session as the region picker: no third session, no connection slot taken', async () => {
        const controller = build('compare');
        controller.open();
        await advanceSeconds(1);
        // no regions saved yet: the window is where they are picked
        expect(controller.mode()).toBe('pick');
        expect(api['createEmbeddedMpvPreviewSession']).not.toHaveBeenCalled();
        expect(suspendAudio).not.toHaveBeenCalled();
        // picking needs the whole frame: the sound's own session is reopened
        // uncropped (once), not a new session next to it
        expect(bridge.reopen).toHaveBeenCalledTimes(1);
        expect(bridge.reopen).toHaveBeenCalledWith(null);
        controller.close();
        expect(api['detachEmbeddedMpvFrameView']).toHaveBeenCalledWith(
            'preview'
        );
        expect(api['disposeEmbeddedMpvSession']).not.toHaveBeenCalled();
    });

    it('while picking, attaches the reopened (uncropped) sound session and ends the opening state', async () => {
        let current = STATUS;
        bridge.status = () => current;
        // no picture reaches the canvas until the reopened session is attached
        api['captureEmbeddedMpvFrame'].mockImplementation(() =>
            api['attachEmbeddedMpvFrameView'].mock.calls.length > 0
                ? frame()
                : null
        );
        const controller = build('compare');
        controller.open();
        await advanceSeconds(1);
        expect(controller.previewStatus()).toBe('starting');
        expect(api['attachEmbeddedMpvFrameView']).not.toHaveBeenCalled();

        // the reopened session comes up uncropped
        current = {
            ...STATUS,
            soundSessionId: 'sound-2',
            clockRegion: null,
        } as EmbeddedMpvSplitAudioStatus;
        await advanceSeconds(1);
        expect(api['attachEmbeddedMpvFrameView']).toHaveBeenCalledWith(
            'sound-2',
            'preview'
        );
        expect(controller.previewStatus()).toBe('live');
        controller.shutdown();
    });

    it('Auto keeps reading and reporting after the window is closed', async () => {
        const controller = build('compare', true);
        expect(controller.startAuto()).toBe(true);
        await advanceSeconds(8);
        // the window never opened: the reading runs in the background
        expect(controller.isOpen()).toBe(false);
        const automatic = () =>
            (bridge.report as jest.Mock).mock.calls.filter(
                (call) => call[1] === false
            ).length;
        expect(automatic()).toBeGreaterThan(0);

        // opened to check the regions, then closed: still reading
        controller.open();
        await advanceSeconds(2);
        controller.close();
        expect(controller.autoRunning()).toBe(true);
        const before = automatic();
        await advanceSeconds(6);
        expect(automatic()).toBeGreaterThan(before);
        expect(api['createEmbeddedMpvPreviewSession']).not.toHaveBeenCalled();

        controller.shutdown();
        const stopped = automatic();
        await advanceSeconds(6);
        expect(automatic()).toBe(stopped);
        expect(controller.autoRunning()).toBe(false);
        expect(api['detachEmbeddedMpvFrameView']).toHaveBeenCalledWith(
            'preview'
        );
    });

    it('Auto opens the window to pick the clock regions when they are missing', async () => {
        const controller = build('compare');
        controller.startAuto();
        await advanceSeconds(1);
        expect(controller.isOpen()).toBe(true);
        expect(controller.mode()).toBe('pick');
        controller.shutdown();
    });

    it('stopping Auto with the window closed stops the reading', async () => {
        const controller = build('compare', true);
        controller.startAuto();
        await advanceSeconds(2);
        controller.stopAuto();
        expect(controller.autoRunning()).toBe(false);
        (bridge.report as jest.Mock).mockClear();
        await advanceSeconds(6);
        expect(bridge.report).not.toHaveBeenCalled();
    });

    it('does not turn a reading into an added delay: the correction closes the gap', async () => {
        const controller = build('compare', true);
        controller.startAuto();
        await advanceSeconds(4);
        controller.applySuggestion();
        expect(setDelay).not.toHaveBeenCalled();
        controller.shutdown();
    });

    it('still opens a preview session when the two-session mode is off', async () => {
        bridge = { ...bridge, enabled: () => false };
        const controller = build('compare');
        controller.open();
        await advanceSeconds(1);
        expect(api['createEmbeddedMpvPreviewSession']).toHaveBeenCalled();
        expect(suspendAudio).toHaveBeenCalled();
        controller.close();
    });
});
