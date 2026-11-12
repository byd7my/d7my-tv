import {
    ControlsStreamStats,
    STREAM_STATS_SAMPLE_INTERVAL_MS,
} from './controls-stream-stats';
import { type PlayerStreamStatsSource } from './player-stream-stats.model';
import { WebVideoStreamStatsSampler } from './web-video-stream-stats';
import { emptyStreamStats } from './stream-stats.spec-helpers';

const rowsOf = (stats: ControlsStreamStats) =>
    stats.view().sections.flatMap((section) => section.rows);

describe('ControlsStreamStats', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const createSource = (
        sample: jest.Mock = jest.fn(() => emptyStreamStats({ fps: 25 }))
    ): { source: PlayerStreamStatsSource; sample: jest.Mock } => ({
        source: { sample: sample as PlayerStreamStatsSource['sample'] },
        sample,
    });

    it('samples nothing until it is started', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        jest.advanceTimersByTime(5 * STREAM_STATS_SAMPLE_INTERVAL_MS);

        expect(sample).not.toHaveBeenCalled();
        expect(stats.hasRows()).toBe(false);
    });

    it('samples immediately on start, then on the interval', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        expect(sample).toHaveBeenCalledTimes(1);
        expect(stats.hasRows()).toBe(true);

        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 3);
        expect(sample).toHaveBeenCalledTimes(4);
    });

    it('stops sampling and forgets the snapshot when closed', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        stats.stop();
        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 3);

        expect(sample).toHaveBeenCalledTimes(1);
        // A reopen must show fresh numbers, never the previous stream's.
        expect(stats.hasRows()).toBe(false);
    });

    it('starts a fresh frame measurement when reopened after a long pause', () => {
        const quality = { totalVideoFrames: 100, droppedVideoFrames: 0 };
        const video = {
            videoWidth: 640,
            videoHeight: 360,
            paused: false,
            readyState: 4,
            buffered: { length: 0 },
            getVideoPlaybackQuality: () => quality,
        } as unknown as HTMLVideoElement;
        const sampler = new WebVideoStreamStatsSampler(
            () => video,
            () => null
        );
        const stats = new ControlsStreamStats(() => sampler);
        stats.start();
        quality.totalVideoFrames += 30;
        jest.advanceTimersByTime(1000);
        expect(rowsOf(stats)).toContainEqual(
            expect.objectContaining({
                labelKey: 'EMBEDDED_MPV.PLAYER.STATS_FRAME_RATE',
                value: '30 fps',
            })
        );
        stats.stop();
        jest.advanceTimersByTime(60000);
        quality.totalVideoFrames += 30;
        stats.start();
        expect(
            rowsOf(stats).some((row) =>
                row.labelKey.endsWith('STATS_FRAME_RATE')
            )
        ).toBe(false);
        quality.totalVideoFrames += 30;
        jest.advanceTimersByTime(1000);
        expect(rowsOf(stats)).toContainEqual(
            expect.objectContaining({
                labelKey: 'EMBEDDED_MPV.PLAYER.STATS_FRAME_RATE',
                value: '30 fps',
            })
        );
        stats.dispose();
    });

    it('restarting does not leave a second interval running', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        stats.start();
        sample.mockClear();

        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS);
        expect(sample).toHaveBeenCalledTimes(1);
    });

    it('groups the sampled snapshot into sections', () => {
        const { source } = createSource(
            jest.fn(() => emptyStreamStats({ width: 1920, height: 1080 }))
        );
        const stats = new ControlsStreamStats(() => source);

        stats.start();

        expect(stats.view().sections).toEqual([
            {
                titleKey: 'EMBEDDED_MPV.PLAYER.STATS_SECTION_PICTURE',
                rows: [
                    expect.objectContaining({
                        labelKey: 'EMBEDDED_MPV.PLAYER.STATS_RESOLUTION',
                        value: '1920 × 1080',
                        detail: 'Full HD · 16:9',
                    }),
                ],
            },
        ]);
    });

    it('keeps the explanations hidden until the viewer asks for them', () => {
        const stats = new ControlsStreamStats(() => undefined);

        expect(stats.showHints()).toBe(false);
        stats.toggleHints();
        expect(stats.showHints()).toBe(true);
        stats.toggleHints();
        expect(stats.showHints()).toBe(false);
    });

    it('survives an engine that throws while tearing down', () => {
        const { source } = createSource(
            jest.fn(() => {
                throw new Error('engine gone');
            })
        );
        const stats = new ControlsStreamStats(() => source);

        expect(() => stats.start()).not.toThrow();
        expect(stats.hasRows()).toBe(false);
    });

    it('treats a controller without a stats source as empty', () => {
        const stats = new ControlsStreamStats(() => undefined);

        stats.start();

        expect(stats.hasRows()).toBe(false);
    });

    it('clears its interval on dispose', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        stats.dispose();
        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 2);

        expect(sample).toHaveBeenCalledTimes(1);
    });
});
