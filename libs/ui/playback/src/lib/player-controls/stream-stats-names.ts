import { formatCodec } from './stream-stats-format.utils';

/**
 * Plain names for what the engine reports. Only a spelling: the value still
 * comes from the live stream, an unknown id is shown as the engine wrote it.
 */
const CODEC_NAMES: Readonly<Record<string, string>> = {
    h264: 'H.264 (AVC)',
    avc: 'H.264 (AVC)',
    avc1: 'H.264 (AVC)',
    hevc: 'H.265 (HEVC)',
    h265: 'H.265 (HEVC)',
    hvc1: 'H.265 (HEVC)',
    hev1: 'H.265 (HEVC)',
    av1: 'AV1',
    av01: 'AV1',
    vp9: 'VP9',
    vp09: 'VP9',
    vp8: 'VP8',
    mpeg2video: 'MPEG-2',
    mpeg4: 'MPEG-4',
    vc1: 'VC-1',
    aac: 'AAC',
    mp4a: 'AAC',
    ac3: 'Dolby Digital (AC-3)',
    'ac-3': 'Dolby Digital (AC-3)',
    eac3: 'Dolby Digital Plus (E-AC-3)',
    'ec-3': 'Dolby Digital Plus (E-AC-3)',
    truehd: 'Dolby TrueHD',
    dts: 'DTS',
    mp2: 'MP2',
    mp2float: 'MP2',
    mp3: 'MP3',
    mp3float: 'MP3',
    opus: 'Opus',
    vorbis: 'Vorbis',
    flac: 'FLAC',
};

const CONTAINER_NAMES: Readonly<Record<string, string>> = {
    mpegts: 'MPEG-TS',
    hls: 'HLS',
    dash: 'DASH',
    flv: 'FLV',
    matroska: 'Matroska',
    'matroska,webm': 'WebM / Matroska',
    'mov,mp4,m4a,3gp,3g2,mj2': 'MP4',
};

export function codecLabel(codec: string | null): string | null {
    const family = formatCodec(codec);
    return family ? (CODEC_NAMES[family.toLowerCase()] ?? family) : null;
}

export function containerLabel(container: string | null): string | null {
    const trimmed = container?.trim();
    return trimmed ? (CONTAINER_NAMES[trimmed.toLowerCase()] ?? trimmed) : null;
}

/**
 * The everyday name of a picture size ("Full HD"), taken from the measured
 * coded size. Either side can qualify it, so a cropped 1920x800 film is still
 * Full HD and a 1440x1080 anamorphic stream is not called HD.
 */
export function qualityLabel(
    width: number | null,
    height: number | null
): string | null {
    if (!width || !height || width <= 0 || height <= 0) {
        return null;
    }
    if (width >= 3200 || height >= 2000) return '4K';
    if (width >= 2400 || height >= 1300) return 'QHD';
    if (width >= 1800 || height >= 1000) return 'Full HD';
    if (width >= 1200 || height >= 700) return 'HD';
    return 'SD';
}
