const mockStoreGet = jest.fn();

jest.mock('./store.service', () => ({
    EMBEDDED_MPV_AUTO_RECONNECT: 'EMBEDDED_MPV_AUTO_RECONNECT',
    EMBEDDED_MPV_EXTRA_OPTIONS: 'EMBEDDED_MPV_EXTRA_OPTIONS',
    EMBEDDED_MPV_SPLIT_AUDIO: 'EMBEDDED_MPV_SPLIT_AUDIO',
    EMBEDDED_MPV_SPLIT_AUDIO_D_BASE: 'EMBEDDED_MPV_SPLIT_AUDIO_D_BASE',
    store: { get: mockStoreGet },
}));

import { readEmbeddedMpvSessionOptions } from './embedded-mpv-session-options';

function storeWith(values: Record<string, unknown>): void {
    mockStoreGet.mockImplementation((key: string, fallback: unknown) =>
        key in values ? values[key] : fallback
    );
}

describe('readEmbeddedMpvSessionOptions - two-session audio', () => {
    const saved = process.env['IPTVNATOR_EMBEDDED_MPV_SPLIT_AUDIO'];

    afterEach(() => {
        if (saved === undefined) {
            delete process.env['IPTVNATOR_EMBEDDED_MPV_SPLIT_AUDIO'];
        } else {
            process.env['IPTVNATOR_EMBEDDED_MPV_SPLIT_AUDIO'] = saved;
        }
    });

    beforeEach(() => {
        delete process.env['IPTVNATOR_EMBEDDED_MPV_SPLIT_AUDIO'];
    });

    it('is off by default, so the audio-add path stays the default', () => {
        storeWith({});
        const options = readEmbeddedMpvSessionOptions();
        expect(options.splitAudio).toBe(false);
        expect(options.splitAudioDBaseSeconds).toBeUndefined();
    });

    it('is on only for an explicit setting', () => {
        storeWith({ EMBEDDED_MPV_SPLIT_AUDIO: true });
        expect(readEmbeddedMpvSessionOptions().splitAudio).toBe(true);
        storeWith({ EMBEDDED_MPV_SPLIT_AUDIO: 'yes' });
        expect(readEmbeddedMpvSessionOptions().splitAudio).toBe(false);
    });

    it('can be switched on for a run with the environment variable', () => {
        storeWith({});
        process.env['IPTVNATOR_EMBEDDED_MPV_SPLIT_AUDIO'] = '1';
        expect(readEmbeddedMpvSessionOptions().splitAudio).toBe(true);
    });

    it('passes the picture delay through, clamped to a sane range', () => {
        storeWith({ EMBEDDED_MPV_SPLIT_AUDIO_D_BASE: 0.12 });
        expect(readEmbeddedMpvSessionOptions().splitAudioDBaseSeconds).toBe(
            0.12
        );
        storeWith({ EMBEDDED_MPV_SPLIT_AUDIO_D_BASE: 9 });
        expect(readEmbeddedMpvSessionOptions().splitAudioDBaseSeconds).toBe(
            0.5
        );
        storeWith({ EMBEDDED_MPV_SPLIT_AUDIO_D_BASE: 'x' });
        expect(
            readEmbeddedMpvSessionOptions().splitAudioDBaseSeconds
        ).toBeUndefined();
    });

    it('keeps the existing options', () => {
        storeWith({ EMBEDDED_MPV_AUTO_RECONNECT: false });
        expect(readEmbeddedMpvSessionOptions().autoReconnect).toBe(false);
    });
});
