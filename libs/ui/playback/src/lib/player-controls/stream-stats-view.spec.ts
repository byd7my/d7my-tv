import { buildStreamStatsView } from './stream-stats-view';
import { emptyStreamStats } from './stream-stats.spec-helpers';

const P = 'EMBEDDED_MPV.PLAYER.';
const rowLabels = (view: ReturnType<typeof buildStreamStatsView>) =>
    view.sections.map((section) => section.rows.map((row) => row.labelKey));

describe('buildStreamStatsView', () => {
    it('returns an empty view for an absent snapshot', () => {
        expect(buildStreamStatsView(null)).toEqual({
            headline: null,
            engine: null,
            sections: [],
        });
    });

    it('groups what was measured into picture, sound and connection', () => {
        const view = buildStreamStatsView(
            emptyStreamStats({
                width: 1920,
                height: 1080,
                fps: 50,
                videoCodec: 'h264',
                videoBitrateBps: 4_600_000,
                audioCodec: 'aac',
                audioBitrateBps: 128_000,
                audioChannels: 6,
                audioSampleRateHz: 48_000,
                container: 'mpegts',
                bufferedAheadSeconds: 8.2,
                droppedFrames: 2,
                totalFrames: 4000,
                networkBitrateBps: 4_900_000,
            })
        );

        expect(view.sections.map((section) => section.titleKey)).toEqual([
            `${P}STATS_SECTION_PICTURE`,
            `${P}STATS_SECTION_SOUND`,
            `${P}STATS_SECTION_CONNECTION`,
        ]);
        expect(rowLabels(view)).toEqual([
            [`${P}STATS_RESOLUTION`, `${P}STATS_FRAME_RATE`, `${P}STATS_VIDEO`],
            [
                `${P}STATS_AUDIO`,
                `${P}STATS_AUDIO_CHANNELS`,
                `${P}STATS_SAMPLE_RATE`,
            ],
            [
                `${P}STATS_NETWORK_BITRATE`,
                `${P}STATS_BUFFER`,
                `${P}STATS_DROPPED_FRAMES`,
                `${P}STATS_CONTAINER`,
            ],
        ]);
    });

    it('gives the main value and its qualifier separately, with a plain name', () => {
        const [picture, sound, connection] = buildStreamStatsView(
            emptyStreamStats({
                width: 1920,
                height: 1080,
                videoCodec: 'hevc',
                videoBitrateBps: 4_006_669,
                audioCodec: 'ac3',
                audioBitrateBps: 384_000,
                container: 'mpegts',
            })
        ).sections;

        expect(picture.rows).toEqual([
            {
                labelKey: `${P}STATS_RESOLUTION`,
                value: '1920 × 1080',
                detail: 'Full HD · 16:9',
                hintKey: `${P}STATS_HINT_RESOLUTION`,
            },
            {
                labelKey: `${P}STATS_VIDEO`,
                value: 'H.265 (HEVC)',
                detail: '4.0 Mbps',
                hintKey: `${P}STATS_HINT_VIDEO`,
            },
        ]);
        expect(sound.rows[0]).toEqual(
            expect.objectContaining({
                value: 'Dolby Digital (AC-3)',
                detail: '384 kbps',
            })
        );
        expect(connection.rows[0]).toEqual(
            expect.objectContaining({ value: 'MPEG-TS' })
        );
    });

    it('shows the coded size and, apart, the size it is displayed at', () => {
        const [picture] = buildStreamStatsView(
            emptyStreamStats({
                width: 1440,
                height: 1080,
                displayWidth: 1920,
                displayHeight: 1080,
            })
        ).sections;

        expect(picture.rows.map((row) => [row.labelKey, row.value])).toEqual([
            [`${P}STATS_RESOLUTION`, '1440 × 1080'],
            [`${P}STATS_DISPLAYED_AS`, '1920 × 1080'],
        ]);
        expect(picture.rows[0].detail).toBe('Full HD · 4:3');
    });

    it('keeps a codec without its bitrate and a bitrate without its codec', () => {
        const [picture, sound] = buildStreamStatsView(
            emptyStreamStats({ videoCodec: 'av1', audioBitrateBps: 96_000 })
        ).sections;

        expect(picture.rows).toEqual([
            expect.objectContaining({ value: 'AV1' }),
        ]);
        expect(picture.rows[0].detail).toBeUndefined();
        expect(sound.rows).toEqual([
            expect.objectContaining({ value: '96 kbps' }),
        ]);
    });

    it('passes through a codec it has no plain name for', () => {
        const [picture] = buildStreamStatsView(
            emptyStreamStats({ videoCodec: 'avc1.640028' })
        ).sections;

        expect(picture.rows[0].value).toBe('H.264 (AVC)');
        expect(
            buildStreamStatsView(emptyStreamStats({ videoCodec: 'wmv3' }))
                .sections[0].rows[0].value
        ).toBe('wmv3');
    });

    it('keeps declared rates apart from measured ones', () => {
        const [picture, connection] = buildStreamStatsView({
            ...emptyStreamStats({ fps: 0, videoCodec: 'h264' }),
            nominalFps: 30,
            streamBitrateBps: 3_000_000,
            bufferedAheadSeconds: 1,
        }).sections;

        expect(picture.rows.map((row) => [row.labelKey, row.value])).toEqual([
            [`${P}STATS_FRAME_RATE`, '0 fps'],
            [`${P}STATS_NOMINAL_FRAME_RATE`, '30 fps'],
            [`${P}STATS_VIDEO`, 'H.264 (AVC)'],
        ]);
        expect(connection.rows.map((row) => row.labelKey)).toEqual([
            `${P}STATS_BUFFER`,
            `${P}STATS_STREAM_BITRATE`,
        ]);
    });

    it('shows a stalled download as a real zero', () => {
        const [connection] = buildStreamStatsView(
            emptyStreamStats({ networkBitrateBps: 0 })
        ).sections;

        expect(connection.rows[0]).toEqual(
            expect.objectContaining({
                labelKey: `${P}STATS_NETWORK_BITRATE`,
                value: '0 kbps',
            })
        );
    });

    it('names hardware and software decoding with translatable words', () => {
        const decoding = (decoder: string) =>
            buildStreamStatsView(emptyStreamStats({ decoder })).sections[0]
                .rows[0];

        expect(decoding('no')).toEqual(
            expect.objectContaining({
                valueKey: `${P}STATS_SOFTWARE_DECODING`,
            })
        );
        expect(decoding('d3d11va')).toEqual(
            expect.objectContaining({
                valueKey: `${P}STATS_HARDWARE_DECODING`,
                detail: 'd3d11va',
            })
        );
    });

    it.each([
        ['playing', 'good'],
        ['buffering', 'wait'],
        ['reconnecting', 'wait'],
        ['loading', 'wait'],
        ['error', 'bad'],
        ['paused', 'idle'],
        ['ended', 'idle'],
    ] as const)('reads %s as %s at a glance', (status, tone) => {
        const view = buildStreamStatsView(
            emptyStreamStats({ fps: 25, status, engine: ' Embedded MPV ' })
        );

        expect(view.headline).toEqual({
            labelKey: `${P}STATS_STATUS_${status.toUpperCase()}`,
            tone,
        });
        expect(view.engine).toBe('Embedded MPV');
    });

    it('leaves out every row the engine did not report', () => {
        const view = buildStreamStatsView(emptyStreamStats({ fps: 25 }));

        expect(rowLabels(view)).toEqual([[`${P}STATS_FRAME_RATE`]]);
        expect(view.headline).toBeNull();
    });

    it('has no aspect when only one dimension is known', () => {
        expect(
            buildStreamStatsView(
                emptyStreamStats({ width: 1920, height: null })
            ).sections
        ).toEqual([]);
    });
});
