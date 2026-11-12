import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import {
    hasStreamStatsData,
    type PlayerStreamStats,
    type PlayerStreamStatus,
} from '../player-controls/player-stream-stats.model';

/**
 * Projects an mpv session snapshot onto the shared stream-stats shape.
 *
 * The numbers arrive already sampled by the main process (mpv pushes observed
 * properties), so this is a pure mapping — no polling of its own. Returns null
 * when the engine reported nothing usable, which is what keeps the info button
 * hidden on engines that do not observe these properties.
 */
export function toPlayerStreamStats(
    session: EmbeddedMpvSession | null | undefined
): PlayerStreamStats | null {
    if (!session) {
        return null;
    }

    const stats = session.stats;
    // The coded size is what the stream really is; the displayed size (mpv
    // `dwidth`/`dheight`) is only shown when it differs. An engine that does
    // not report the coded size keeps the displayed one as before.
    const shownWidth = positiveOrNull(session.videoWidth);
    const shownHeight = positiveOrNull(session.videoHeight);
    const codedWidth = positiveOrNull(stats?.sourceWidth);
    const codedHeight = positiveOrNull(stats?.sourceHeight);
    const hasCoded = codedWidth !== null && codedHeight !== null;
    const differs =
        hasCoded &&
        shownWidth !== null &&
        shownHeight !== null &&
        (shownWidth !== codedWidth || shownHeight !== codedHeight);
    // Every field is listed explicitly (no spread of a neutral default): a new
    // stat then fails to compile here until mpv's source for it is decided,
    // instead of silently reporting null forever.
    const measured: PlayerStreamStats = {
        width: hasCoded ? codedWidth : shownWidth,
        height: hasCoded ? codedHeight : shownHeight,
        fps: finiteOrNull(stats?.fps),
        nominalFps: null,
        streamBitrateBps: null,
        videoBitrateBps: finiteOrNull(stats?.videoBitrateBps),
        audioBitrateBps: finiteOrNull(stats?.audioBitrateBps),
        videoCodec: nonEmptyOrNull(stats?.videoCodec),
        audioCodec: nonEmptyOrNull(stats?.audioCodec),
        audioChannels: nonEmptyOrNull(stats?.audioChannels),
        audioSampleRateHz: finiteOrNull(stats?.audioSampleRateHz),
        container: nonEmptyOrNull(stats?.container),
        bufferedAheadSeconds: finiteOrNull(stats?.bufferedAheadSeconds),
        droppedFrames: finiteOrNull(stats?.droppedFrames),
        // mpv counts drops, not presented frames, so a drop rate cannot be
        // derived here the way it can from a <video> element.
        totalFrames: null,
        displayWidth: differs ? shownWidth : null,
        displayHeight: differs ? shownHeight : null,
        networkBitrateBps: finiteOrNull(stats?.networkBitrateBps),
        status: null,
        engine: null,
        decoder: nonEmptyOrNull(stats?.hwdec),
    };

    // Whether there is anything to show is decided by what was measured; the
    // engine name and the status alone must not make the info button appear.
    if (!hasStreamStatsData(measured)) {
        return null;
    }
    return {
        ...measured,
        status: statusOf(session),
        engine: 'Embedded MPV',
    };
}

function statusOf(session: EmbeddedMpvSession): PlayerStreamStatus | null {
    if (session.status === 'error') return 'error';
    if (session.status === 'ended') return 'ended';
    if (session.reconnect) return 'reconnecting';
    if (session.status === 'loading') return 'loading';
    if (session.stats?.buffering) return 'buffering';
    if (session.status === 'paused') return 'paused';
    return session.status === 'playing' ? 'playing' : null;
}

function finiteOrNull(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyOrNull(value: string | undefined): string | null {
    return value?.trim() ? value.trim() : null;
}

function positiveOrNull(value: number | undefined): number | null {
    const finite = finiteOrNull(value);
    return finite !== null && finite > 0 ? finite : null;
}
