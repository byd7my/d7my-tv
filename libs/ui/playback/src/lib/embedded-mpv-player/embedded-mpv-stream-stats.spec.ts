import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { toPlayerStreamStats } from './embedded-mpv-stream-stats';

function createSession(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: 'Channel',
        streamUrl: 'http://example.test/stream.ts',
        status: 'playing',
        positionSeconds: 12,
        durationSeconds: null,
        volume: 1,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:10.000Z',
        ...overrides,
    };
}

describe('toPlayerStreamStats', () => {
    it('maps mpv properties onto the shared stats shape', () => {
        const stats = toPlayerStreamStats(
            createSession({
                videoWidth: 1920,
                videoHeight: 1080,
                stats: {
                    fps: 50.04,
                    videoBitrateBps: 6_200_000,
                    audioBitrateBps: 192_000,
                    videoCodec: 'h264',
                    audioCodec: 'aac',
                    audioChannels: '5.1',
                    audioSampleRateHz: 48_000,
                    container: 'mpegts',
                    bufferedAheadSeconds: 18.5,
                    droppedFrames: 3,
                },
            })
        );

        expect(stats).toEqual({
            width: 1920,
            height: 1080,
            fps: 50.04,
            nominalFps: null,
            streamBitrateBps: null,
            videoBitrateBps: 6_200_000,
            audioBitrateBps: 192_000,
            videoCodec: 'h264',
            audioCodec: 'aac',
            audioChannels: '5.1',
            audioSampleRateHz: 48_000,
            container: 'mpegts',
            bufferedAheadSeconds: 18.5,
            droppedFrames: 3,
            // mpv counts drops but never presented frames.
            totalFrames: null,
            displayWidth: null,
            displayHeight: null,
            networkBitrateBps: null,
            status: 'playing',
            engine: 'Embedded MPV',
            decoder: null,
        });
    });

    // Values below were read from a real mpv 0.37 playing a local MPEG-TS
    // (1440x1080 HEVC, sample aspect 4:3, AC-3 5.1) and checked against what
    // ffmpeg encoded: mpv reported dwidth 1920 but video-params/w 1440.
    it('shows the coded size and keeps the displayed size of an anamorphic stream apart', () => {
        const stats = toPlayerStreamStats(
            createSession({
                videoWidth: 1920,
                videoHeight: 1080,
                stats: {
                    sourceWidth: 1440,
                    sourceHeight: 1080,
                    fps: 50,
                    videoBitrateBps: 4_006_669,
                    audioBitrateBps: 384_000,
                    networkBitrateBps: 3_750_960,
                    hwdec: 'no',
                },
            })
        );

        expect(stats).toEqual(
            expect.objectContaining({
                width: 1440,
                height: 1080,
                displayWidth: 1920,
                displayHeight: 1080,
                networkBitrateBps: 3_750_960,
                decoder: 'no',
            })
        );
    });

    it('has no displayed-size row when the shown size equals the coded size', () => {
        const stats = toPlayerStreamStats(
            createSession({
                videoWidth: 1280,
                videoHeight: 720,
                stats: { sourceWidth: 1280, sourceHeight: 720, fps: 25 },
            })
        );

        expect(stats?.displayWidth).toBeNull();
        expect(stats?.displayHeight).toBeNull();
    });

    it.each([
        [{ status: 'error' as const }, 'error'],
        [{ status: 'ended' as const }, 'ended'],
        [{ status: 'loading' as const }, 'loading'],
        [{ status: 'paused' as const }, 'paused'],
        [{ stats: { fps: 25, buffering: true } }, 'buffering'],
        [
            {
                reconnect: {
                    attempt: 1,
                    maxAttempts: 5,
                    nextAttemptAt: '2026-01-01T00:00:20.000Z',
                } as never,
            },
            'reconnecting',
        ],
    ])(
        'reports the status from the live session (%j)',
        (override, expected) => {
            const stats = toPlayerStreamStats(
                createSession({ stats: { fps: 25 }, ...override })
            );

            expect(stats?.status).toBe(expected);
        }
    );

    it('does not make the info button appear for an engine name alone', () => {
        expect(
            toPlayerStreamStats(createSession({ status: 'playing' }))
        ).toBeNull();
    });

    it('keeps the size rows when only dwidth/dheight are known', () => {
        const stats = toPlayerStreamStats(
            createSession({ videoWidth: 1280, videoHeight: 720 })
        );

        expect(stats).toEqual(
            expect.objectContaining({
                width: 1280,
                height: 720,
                fps: null,
                videoCodec: null,
            })
        );
    });

    it('returns null when the engine reported nothing usable', () => {
        expect(toPlayerStreamStats(createSession())).toBeNull();
        expect(toPlayerStreamStats(createSession({ stats: {} }))).toBeNull();
        expect(toPlayerStreamStats(null)).toBeNull();
    });

    it('hides the info capability after dimensions reset to unknown', () => {
        expect(
            toPlayerStreamStats(
                createSession({
                    videoWidth: 0,
                    videoHeight: 0,
                    stats: {},
                })
            )
        ).toBeNull();
    });

    it('drops blank codec strings instead of rendering empty rows', () => {
        const stats = toPlayerStreamStats(
            createSession({
                stats: { videoCodec: '   ', audioCodec: 'aac' },
            })
        );

        expect(stats).toEqual(
            expect.objectContaining({ videoCodec: null, audioCodec: 'aac' })
        );
    });

    it('keeps a zero drop counter — it is a real measurement', () => {
        const stats = toPlayerStreamStats(
            createSession({ stats: { droppedFrames: 0 } })
        );

        expect(stats?.droppedFrames).toBe(0);
    });
});
