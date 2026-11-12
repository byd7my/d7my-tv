import type {
    EmbeddedMpvFrameRegion,
    EmbeddedMpvSplitAudioStatus,
} from '@iptvnator/shared/interfaces';
import { AudioSyncSplit, type SplitAudioBridge } from './audio-sync-split';

const R1: EmbeddedMpvFrameRegion = { x: 0, y: 0, width: 0.45, height: 0.16 };
const R2: EmbeddedMpvFrameRegion = { x: 0.5, y: 0.1, width: 0.3, height: 0.1 };

function status(
    over: Partial<EmbeddedMpvSplitAudioStatus> = {}
): EmbeddedMpvSplitAudioStatus {
    return {
        mode: 'dual-session',
        soundSessionId: 'sound-1',
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
        clockRegion: R1,
        ...over,
    };
}

function setup() {
    const state = {
        enabled: true,
        status: status() as EmbeddedMpvSplitAudioStatus | null,
    };
    const bridge: SplitAudioBridge = {
        enabled: () => state.enabled,
        status: () => state.status,
        report: jest.fn(),
        reopen: jest.fn(),
    };
    const api = {
        attachEmbeddedMpvFrameView: jest.fn().mockResolvedValue(true),
        detachEmbeddedMpvFrameView: jest.fn(),
    };
    const split = new AudioSyncSplit(
        () => bridge,
        () => api
    );
    return { split, state, bridge, api };
}

describe('AudioSyncSplit', () => {
    it('is inactive when the mode is off or there is no bridge', () => {
        const { split, state } = setup();
        state.enabled = false;
        expect(split.active).toBe(false);
        expect(
            new AudioSyncSplit(
                () => null,
                () => undefined
            ).active
        ).toBe(false);
    });

    it('shows the sound session on the preview canvas without reopening it', async () => {
        const { split, bridge, api } = setup();
        await split.start(R1);
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledWith(
            'sound-1',
            'preview'
        );
        expect(bridge.reopen).not.toHaveBeenCalled();
    });

    it('reopens the sound once for a region it was not cropped to, then attaches the new session', async () => {
        const { split, state, bridge, api } = setup();
        await split.start(R2);
        await split.start(R2); // a second call before the new session is up
        expect(bridge.reopen).toHaveBeenCalledTimes(1);
        expect(bridge.reopen).toHaveBeenCalledWith(R2);
        expect(api.attachEmbeddedMpvFrameView).not.toHaveBeenCalled();

        state.status = null; // the old session is closing
        split.sync();
        expect(api.attachEmbeddedMpvFrameView).not.toHaveBeenCalled();
        state.status = status({ soundSessionId: 'sound-2', clockRegion: R2 });
        split.sync();
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledWith(
            'sound-2',
            'preview'
        );
    });

    it('waits for the pair to come up when asked to start before it exists', async () => {
        const { split, state, api } = setup();
        state.status = null;
        await split.start(R1);
        expect(api.attachEmbeddedMpvFrameView).not.toHaveBeenCalled();
        state.status = status();
        split.sync();
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledWith(
            'sound-1',
            'preview'
        );
    });

    it('follows a sound session that was replaced by a reconnect', async () => {
        const { split, state, api } = setup();
        await split.start(R1);
        state.status = status({ soundSessionId: 'sound-9' });
        split.sync();
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenLastCalledWith(
            'sound-9',
            'preview'
        );
    });

    it('tries again on the next tick when the first attach to a new session is refused', async () => {
        const { split, api } = setup();
        api.attachEmbeddedMpvFrameView
            .mockResolvedValueOnce(false)
            .mockResolvedValue(true);
        await split.start(R1);
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledTimes(1);
        split.sync();
        await Promise.resolve();
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledTimes(2);
        await Promise.resolve();
        split.sync(); // attached now: no further attempt
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledTimes(2);
    });

    it('stops looking without touching the sound', async () => {
        const { split, state, api, bridge } = setup();
        await split.start(R1);
        split.stop();
        expect(api.detachEmbeddedMpvFrameView).toHaveBeenCalledWith('preview');
        state.status = status({ soundSessionId: 'sound-2' });
        split.sync(); // no longer wanted
        expect(api.attachEmbeddedMpvFrameView).toHaveBeenCalledTimes(1);
        expect(bridge.reopen).not.toHaveBeenCalled();
    });

    it('turns clock offsets into the lateness of the sound (sign flipped)', () => {
        const { split, bridge } = setup();
        split.reportRead(-0.4);
        expect(bridge.report).toHaveBeenLastCalledWith(0.4, false);
        split.reportCompared(4);
        expect(bridge.report).toHaveBeenLastCalledWith(-4, true);
        split.reportMeasured(1.5);
        expect(bridge.report).toHaveBeenLastCalledWith(-1.5, true);
    });

    it('sends a compared offset once per change and ignores nothing-yet', () => {
        const { split, bridge } = setup();
        split.reportCompared(null);
        split.reportCompared(4);
        split.reportCompared(4);
        split.reportCompared(5);
        expect(bridge.report).toHaveBeenCalledTimes(2);
    });

    it('reports nothing while the mode is off', () => {
        const { split, state, bridge } = setup();
        state.enabled = false;
        split.reportRead(1);
        split.reportCompared(1);
        split.reportMeasured(1);
        expect(bridge.report).not.toHaveBeenCalled();
    });
});
