/**
 * Two-session "audio from another channel" as seen through
 * EmbeddedMpvNativeService: the opt-in mode routes the user's controls to a
 * hidden sound session, and the audio-add path stays the default. The mocks
 * mirror embedded-mpv-native.service.reconnect.spec.ts.
 */
import type {
    EmbeddedMpvBounds,
    EmbeddedMpvSession,
    EmbeddedMpvSessionStatus,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { EmbeddedMpvNativeService as EmbeddedMpvNativeServiceType } from './embedded-mpv-native.service';

const mockSpawnSync = jest.fn();
const mockIsFrameCopyRuntimeUsable = jest.fn<boolean, []>();
const mockGetFrameCopyRuntimeAvailability = jest.fn();

jest.mock('child_process', () => ({
    spawnSync: mockSpawnSync,
}));

const recordingTrackerMock = {
    onRecordingStarted: jest.fn(),
    onRecordingStopped: jest.fn(),
    onRecordingInterrupted: jest.fn(),
    observeSnapshot: jest.fn(),
};
jest.mock('./embedded-mpv-recording-tracker', () => ({
    embeddedMpvRecordingTracker: recordingTrackerMock,
}));

jest.mock('./embedded-mpv-frame-copy-platform.util', () => {
    const actual = jest.requireActual(
        './embedded-mpv-frame-copy-platform.util'
    );
    return {
        ...actual,
        getFrameCopyRuntimeAvailability: mockGetFrameCopyRuntimeAvailability,
        isFrameCopyRuntimeUsable: mockIsFrameCopyRuntimeUsable,
    };
});

const powerSaveBlockerMock = {
    start: jest.fn<number, [string]>(() => 1),
    stop: jest.fn<void, [number]>(),
    isStarted: jest.fn<boolean, [number]>(() => true),
};
let userDataDir = '';
const appMock = {
    isPackaged: true,
    getAppPath: () => '/mock/app.asar',
    getPath: () => userDataDir,
    commandLine: { getSwitchValue: jest.fn<string, [string]>(() => '') },
};

jest.mock('electron', () => ({
    app: appMock,
    powerSaveBlocker: powerSaveBlockerMock,
    screen: { getDisplayMatching: jest.fn(() => ({ scaleFactor: 1 })) },
}));

const mainWindowSendMock = jest.fn();
const mainWindowMock = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(8),
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    webContents: {
        send: mainWindowSendMock,
        on: jest.fn(),
        getZoomFactor: () => 1,
    },
};

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        get mainWindow() {
            return mainWindowMock;
        },
    },
}));

const BOUNDS: EmbeddedMpvBounds = { x: 0, y: 0, width: 100, height: 100 };
const LIVE: ResolvedPortalPlayback = {
    streamUrl: 'http://host/live.ts',
    title: 'Live channel',
    isLive: true,
};
const OTHER: ResolvedPortalPlayback = {
    streamUrl: 'http://host/other.ts',
    title: 'Other channel',
    isLive: true,
};

interface Snap {
    status: EmbeddedMpvSessionStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    streamUrl: string;
    playbackSpeed: number;
    recording: { active: boolean };
}

describe('EmbeddedMpvNativeService two-session audio', () => {
    let EmbeddedMpvNativeService: typeof EmbeddedMpvNativeServiceType;
    let service: EmbeddedMpvNativeServiceType;
    let snaps: Map<string, Snap>;
    let created: string[];
    let addon: Record<string, jest.Mock>;
    let originalPlatform: NodeJS.Platform;
    let originalArch: string;
    let originalExperiment: string | undefined;

    const snap = (status: EmbeddedMpvSessionStatus, volume = 0.5): Snap => ({
        status,
        // a playing stream advances with the (fake) clock
        positionSeconds: Date.now() / 1000,
        durationSeconds: null,
        volume,
        streamUrl: LIVE.streamUrl,
        playbackSpeed: 1,
        recording: { active: false },
    });

    beforeEach(async () => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-03T10:00:00Z'));
        mainWindowSendMock.mockReset();
        mockSpawnSync.mockReset();
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockIsFrameCopyRuntimeUsable.mockReturnValue(false);
        mockGetFrameCopyRuntimeAvailability.mockReturnValue({
            usable: false,
            reason: 'helper-probe-failed',
        });
        originalPlatform = process.platform;
        originalArch = process.arch;
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        Object.defineProperty(process, 'arch', { value: 'arm64' });
        originalExperiment =
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT = '1';
        userDataDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-mpv-split-'));
        ({ EmbeddedMpvNativeService } =
            await import('./embedded-mpv-native.service'));
        service = new EmbeddedMpvNativeService();

        snaps = new Map();
        created = [];
        addon = {
            isSupported: jest.fn(() => true),
            createSession: jest.fn(() => {
                const id =
                    created.length === 0 ? 'main' : `sound-${created.length}`;
                created.push(id);
                snaps.set(id, snap('idle'));
                return id;
            }),
            loadPlayback: jest.fn(),
            getSessionSnapshot: jest.fn((id: string) => {
                const current = snaps.get(id);
                return (
                    current && {
                        ...current,
                        positionSeconds: Date.now() / 1000,
                    }
                );
            }),
            disposeSession: jest.fn(),
            setBounds: jest.fn(),
            setPaused: jest.fn(),
            seek: jest.fn(),
            seekBy: jest.fn(),
            setVolume: jest.fn(),
            setSpeed: jest.fn(),
            setAudioTrack: jest.fn(),
            setExternalAudio: jest.fn(),
            setExternalAudioDelay: jest.fn(),
        };
        const internals = service as unknown as {
            addon: unknown;
            frameCopyAdapter: unknown;
        };
        internals.addon = addon;
        internals.frameCopyAdapter = addon; // the frame-copy engine is the active one
    });

    afterEach(() => {
        service.shutdown();
        jest.useRealTimers();
        rmSync(userDataDir, { recursive: true, force: true });
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        Object.defineProperty(process, 'arch', { value: originalArch });
        if (originalExperiment === undefined) {
            delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
        } else {
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT =
                originalExperiment;
        }
    });

    const startMain = (splitAudio: boolean) => {
        service.createSession(BOUNDS, 'Title', 0.5, {
            extraOptions: [],
            autoReconnect: true,
            splitAudio,
        });
        service.loadPlayback('main', LIVE);
        snaps.set('main', snap('playing'));
        jest.advanceTimersByTime(500);
    };

    const startPair = () => {
        startMain(true);
        service.setExternalAudio('main', OTHER, 0);
        snaps.set('sound-1', snap('playing', 0));
        jest.advanceTimersByTime(500);
    };

    const lastUpdateFor = (id: string): EmbeddedMpvSession | undefined =>
        mainWindowSendMock.mock.calls
            .map((call) => call[1] as EmbeddedMpvSession)
            .filter((update) => update?.id === id)
            .at(-1);

    it('keeps the audio-add path when the mode is off', () => {
        startMain(false);
        service.setExternalAudio('main', OTHER, 0.2);
        expect(addon['setExternalAudio']).toHaveBeenCalledWith(
            'main',
            OTHER,
            0.2
        );
        expect(created).toEqual(['main']);
        service.setVolume('main', 0.8);
        expect(addon['setVolume']).toHaveBeenLastCalledWith('main', 0.8);
        service.setSpeed('main', 1.5);
        expect(addon['setSpeed']).toHaveBeenLastCalledWith('main', 1.5);
        expect(lastUpdateFor('main')?.splitAudioEnabled).toBeUndefined();
    });

    it('falls back to audio-add when the engine is not frame-copy', () => {
        (service as unknown as { frameCopyAdapter: unknown }).frameCopyAdapter =
            null;
        startMain(true);
        service.setExternalAudio('main', OTHER, 0);
        expect(addon['setExternalAudio']).toHaveBeenCalled();
        expect(created).toEqual(['main']);
    });

    it('plays the other channel in a hidden second session and mutes the picture', () => {
        startPair();
        expect(created).toEqual(['main', 'sound-1']);
        expect(addon['setExternalAudio']).not.toHaveBeenCalled();
        expect(addon['loadPlayback']).toHaveBeenCalledWith(
            'sound-1',
            expect.objectContaining({ streamUrl: OTHER.streamUrl })
        );
        expect(addon['setVolume']).toHaveBeenCalledWith('main', 0);
        const update = lastUpdateFor('main');
        expect(update?.splitAudioEnabled).toBe(true);
        expect(update?.splitAudio?.soundSessionId).toBe('sound-1');
    });

    it('refuses a third (preview) session while the mode is on and routes the sync mode', () => {
        startPair();
        expect(() => service.createPreviewSession(undefined)).toThrow(
            /not available/
        );
        expect(created).toEqual(['main', 'sound-1']);
        expect(service.setSplitAudioSyncMode('main', 'manual')).toBe(true);
        expect(lastUpdateFor('main')?.splitAudio?.syncMode).toBe('manual');
    });

    it('sends pause, seek, volume and speed to both sessions and reports the user values', () => {
        startPair();
        service.setPaused('main', true);
        expect(addon['setPaused']).toHaveBeenCalledWith('main', true);
        expect(addon['setPaused']).toHaveBeenCalledWith('sound-1', true);
        service.seekBy('main', -10);
        expect(addon['seekBy']).toHaveBeenCalledWith('main', -10);
        expect(addon['seekBy']).toHaveBeenCalledWith('sound-1', -10);
        service.setVolume('main', 0.3);
        expect(addon['setVolume']).toHaveBeenLastCalledWith('sound-1', 0.3);
        service.setSpeed('main', 2);
        expect(addon['setSpeed']).toHaveBeenCalledWith('main', 2);
        expect(addon['setSpeed']).toHaveBeenCalledWith('sound-1', 2);
        const update = lastUpdateFor('main');
        expect(update?.volume).toBe(0.3);
        expect(update?.playbackSpeed).toBe(2);
        expect(update?.splitAudio?.userSpeed).toBe(2);
    });

    it('feeds measurements to the correction and slows the picture when the sound is late', () => {
        startPair();
        jest.advanceTimersByTime(6000); // settle time after the start
        expect(service.splitAudioSyncAction('main', 'start')).toBe(true);
        for (let i = 0; i < 40; i++) {
            expect(service.reportSplitAudioLateness('main', 0.8)).toBe(true);
            jest.advanceTimersByTime(500);
        }
        const speeds = addon['setSpeed'].mock.calls
            .filter(([id]) => id === 'main')
            .map(([, speed]) => speed as number);
        expect(speeds.at(-1)).toBeLessThan(1);
        const soundSpeeds = addon['setSpeed'].mock.calls
            .filter(([id]) => id === 'sound-1')
            .map(([, speed]) => speed as number);
        expect(soundSpeeds.every((speed) => speed === 1)).toBe(true);
        expect(lastUpdateFor('main')?.splitAudio?.correcting).toBe('main');
        // the user's own speed was not touched
        expect(lastUpdateFor('main')?.playbackSpeed).toBe(1);
    });

    it('lets the correction go on pause', () => {
        startPair();
        jest.advanceTimersByTime(6000);
        service.splitAudioSyncAction('main', 'start');
        for (let i = 0; i < 40; i++) {
            service.reportSplitAudioLateness('main', 0.8);
            jest.advanceTimersByTime(500);
        }
        expect(lastUpdateFor('main')?.splitAudio?.correcting).toBe('main');
        service.setPaused('main', true);
        const speeds = addon['setSpeed'].mock.calls
            .filter(([id]) => id === 'main')
            .map(([, speed]) => speed as number);
        expect(speeds.at(-1)).toBe(1);
    });

    it('ends the pair when the user loads another picture', () => {
        startPair();
        service.loadPlayback('main', OTHER);
        expect(addon['disposeSession']).toHaveBeenCalledWith('sound-1');
        expect(addon['setVolume']).toHaveBeenLastCalledWith('main', 0.5);
        expect(lastUpdateFor('main')?.splitAudio).toBeUndefined();
        expect(service.reportSplitAudioLateness('main', 1)).toBe(false);
    });

    it('disposes the sound session with the picture session', () => {
        startPair();
        service.disposeSession('main');
        expect(addon['disposeSession']).toHaveBeenCalledWith('sound-1');
        expect(addon['disposeSession']).toHaveBeenCalledWith('main');
    });

    it('reloads a dropped sound session and clears its keep-open pause', () => {
        startPair();
        addon['setPaused'].mockClear();
        addon['loadPlayback'].mockClear();
        snaps.set('sound-1', snap('error'));
        jest.advanceTimersByTime(500);
        snaps.set('sound-1', snap('error'));
        jest.advanceTimersByTime(5000);
        expect(addon['loadPlayback']).toHaveBeenCalledWith(
            'sound-1',
            expect.objectContaining({ streamUrl: OTHER.streamUrl })
        );
        expect(addon['setPaused']).toHaveBeenCalledWith('sound-1', false);
    });

    it('keeps a reloaded sound session paused while the user is paused', () => {
        startPair();
        service.setPaused('main', true);
        addon['setPaused'].mockClear();
        snaps.set('sound-1', snap('error'));
        jest.advanceTimersByTime(6000);
        // user pause cancels a scheduled reload: nothing is un-paused behind their back
        expect(addon['setPaused']).not.toHaveBeenCalledWith('sound-1', false);
    });
});
