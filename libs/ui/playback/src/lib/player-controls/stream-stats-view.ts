import { formatBitrate } from './controls-format.utils';
import type {
    PlayerStreamStats,
    PlayerStreamStatus,
} from './player-stream-stats.model';
import {
    formatAspectRatio,
    formatAudioChannels,
    formatBufferedSeconds,
    formatDroppedFrames,
    formatFrameRate,
    formatNetworkBitrate,
    formatResolution,
    formatSampleRate,
} from './stream-stats-format.utils';
import { codecLabel, containerLabel, qualityLabel } from './stream-stats-names';
import { positiveOrNull } from './positive-number.util';

/**
 * The stream-info popover, as plain data. Rows are grouped by what a viewer
 * wonders about (the picture, the sound, the connection); each carries one
 * main value, an optional second line, and the key of a one-sentence
 * explanation for people who do not know the term. A value the engine did not
 * measure produces no row at all — nothing here is ever guessed.
 */
export interface StreamStatsRow {
    labelKey: string;
    /** The main value; the fallback text when {@link valueKey} is set. */
    value: string;
    /** The value is a translatable word (a decoding mode). */
    valueKey?: string;
    /** A second, quieter line: the unit that qualifies the value. */
    detail?: string;
    /** Plain-language explanation, shown when the viewer asks for it. */
    hintKey?: string;
}

export interface StreamStatsSection {
    titleKey: string;
    rows: StreamStatsRow[];
}

/** How the status reads at a glance: good, waiting, failed, or at rest. */
export type StreamStatsTone = 'good' | 'wait' | 'bad' | 'idle';

export interface StreamStatsHeadline {
    labelKey: string;
    tone: StreamStatsTone;
}

export interface StreamStatsView {
    headline: StreamStatsHeadline | null;
    engine: string | null;
    sections: StreamStatsSection[];
}

const P = 'EMBEDDED_MPV.PLAYER.';

const HEADLINES: Record<PlayerStreamStatus, StreamStatsHeadline> = {
    loading: { labelKey: `${P}STATS_STATUS_LOADING`, tone: 'wait' },
    playing: { labelKey: `${P}STATS_STATUS_PLAYING`, tone: 'good' },
    paused: { labelKey: `${P}STATS_STATUS_PAUSED`, tone: 'idle' },
    buffering: { labelKey: `${P}STATS_STATUS_BUFFERING`, tone: 'wait' },
    reconnecting: { labelKey: `${P}STATS_STATUS_RECONNECTING`, tone: 'wait' },
    ended: { labelKey: `${P}STATS_STATUS_ENDED`, tone: 'idle' },
    error: { labelKey: `${P}STATS_STATUS_ERROR`, tone: 'bad' },
};

type Candidate = {
    key: string;
    value: string | null;
    detail?: string | null;
    valueKey?: string;
};

function rowsOf(candidates: readonly Candidate[]): StreamStatsRow[] {
    const rows: StreamStatsRow[] = [];
    for (const { key, value, detail, valueKey } of candidates) {
        if (value === null) {
            continue;
        }
        rows.push({
            labelKey: `${P}STATS_${key}`,
            value,
            ...(valueKey ? { valueKey } : {}),
            ...(detail ? { detail } : {}),
            hintKey: `${P}STATS_HINT_${key}`,
        });
    }
    return rows;
}

function joined(...parts: Array<string | null>): string | null {
    const kept = parts.filter((part): part is string => part !== null);
    return kept.length > 0 ? kept.join(' · ') : null;
}

/** The codec as the row's main value, its measured rate beneath it. */
function codecCandidate(
    key: string,
    codec: string | null,
    bitrateBps: number | null
): Candidate {
    const name = codecLabel(codec);
    const rate = formatBitrate(bitrateBps);
    return name ? { key, value: name, detail: rate } : { key, value: rate };
}

function decodingCandidate(decoder: string | null): Candidate {
    const mode = decoder?.trim();
    if (!mode) {
        return { key: 'DECODER', value: null };
    }
    return mode === 'no'
        ? {
              key: 'DECODER',
              value: 'software',
              valueKey: `${P}STATS_SOFTWARE_DECODING`,
          }
        : {
              key: 'DECODER',
              value: mode,
              valueKey: `${P}STATS_HARDWARE_DECODING`,
              detail: mode,
          };
}

function pictureRows(stats: PlayerStreamStats): StreamStatsRow[] {
    const size = formatResolution(stats.width, stats.height);
    const shown = formatResolution(stats.displayWidth, stats.displayHeight);
    return rowsOf([
        {
            key: 'RESOLUTION',
            value: size,
            detail: joined(
                qualityLabel(stats.width, stats.height),
                formatAspectRatio(stats.width, stats.height)
            ),
        },
        {
            key: 'DISPLAYED_AS',
            value: shown,
            detail: formatAspectRatio(stats.displayWidth, stats.displayHeight),
        },
        { key: 'FRAME_RATE', value: formatFrameRate(stats.fps) },
        {
            key: 'NOMINAL_FRAME_RATE',
            value: formatFrameRate(positiveOrNull(stats.nominalFps)),
        },
        codecCandidate('VIDEO', stats.videoCodec, stats.videoBitrateBps),
        decodingCandidate(stats.decoder),
    ]);
}

function soundRows(stats: PlayerStreamStats): StreamStatsRow[] {
    return rowsOf([
        codecCandidate('AUDIO', stats.audioCodec, stats.audioBitrateBps),
        {
            key: 'AUDIO_CHANNELS',
            value: formatAudioChannels(stats.audioChannels),
        },
        {
            key: 'SAMPLE_RATE',
            value: formatSampleRate(stats.audioSampleRateHz),
        },
    ]);
}

function connectionRows(stats: PlayerStreamStats): StreamStatsRow[] {
    return rowsOf([
        {
            key: 'NETWORK_BITRATE',
            value: formatNetworkBitrate(stats.networkBitrateBps),
        },
        {
            key: 'BUFFER',
            value: formatBufferedSeconds(stats.bufferedAheadSeconds),
        },
        {
            key: 'DROPPED_FRAMES',
            value: formatDroppedFrames(stats.droppedFrames, stats.totalFrames),
        },
        {
            key: 'STREAM_BITRATE',
            value: formatBitrate(stats.streamBitrateBps),
        },
        { key: 'CONTAINER', value: containerLabel(stats.container) },
    ]);
}

export function buildStreamStatsView(
    stats: PlayerStreamStats | null
): StreamStatsView {
    if (!stats) {
        return { headline: null, engine: null, sections: [] };
    }
    const sections = [
        { titleKey: `${P}STATS_SECTION_PICTURE`, rows: pictureRows(stats) },
        { titleKey: `${P}STATS_SECTION_SOUND`, rows: soundRows(stats) },
        {
            titleKey: `${P}STATS_SECTION_CONNECTION`,
            rows: connectionRows(stats),
        },
    ].filter((section) => section.rows.length > 0);
    return {
        headline: stats.status ? HEADLINES[stats.status] : null,
        engine: stats.engine?.trim() || null,
        sections,
    };
}
