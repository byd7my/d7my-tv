import type {
    EmbeddedMpvBounds,
    EmbeddedMpvFrameRegion,
    EmbeddedMpvPreviewRequest,
} from '@iptvnator/shared/interfaces';

/**
 * Recipe for the silent preview session of the audio-sync window: the
 * helper decodes the audio channel's picture, but only the scoreboard region
 * is cropped out, only a few frames per second are produced, and nothing is
 * played. All of it is mpv options, so the helper binary stays unchanged.
 */

const DEFAULT_OUTPUT_WIDTH = 480;
const MIN_OUTPUT_WIDTH = 160;
const MAX_OUTPUT_WIDTH = 960;
const MIN_OUTPUT_HEIGHT = 24;
const MAX_OUTPUT_HEIGHT = 540;
/** Smallest region edge (fraction of the frame) that is still a region. */
const MIN_REGION_EDGE = 0.02;
/** Frames per second of the crop: enough for a once-a-second clock. */
const PREVIEW_FRAMES_PER_SECOND = 4;
/** Broadcast pictures are 16:9; the region's aspect is derived from it. */
const SOURCE_ASPECT = 16 / 9;

export interface EmbeddedMpvPreviewPlan {
    bounds: EmbeddedMpvBounds;
    /** mpv `key=value` lines, applied after the user's own options. */
    options: string[];
    region: EmbeddedMpvFrameRegion | null;
}

export function clampPreviewRegion(
    region: EmbeddedMpvFrameRegion | undefined
): EmbeddedMpvFrameRegion | null {
    if (!region) return null;
    const values = [region.x, region.y, region.width, region.height];
    if (!values.every((value) => Number.isFinite(value))) return null;
    const width = Math.min(1, Math.max(MIN_REGION_EDGE, region.width));
    const height = Math.min(1, Math.max(MIN_REGION_EDGE, region.height));
    return {
        x: Math.min(1 - width, Math.max(0, region.x)),
        y: Math.min(1 - height, Math.max(0, region.y)),
        width,
        height,
    };
}

function fraction(value: number): string {
    return value.toFixed(4);
}

export function buildEmbeddedMpvPreviewPlan(
    request: EmbeddedMpvPreviewRequest | undefined
): EmbeddedMpvPreviewPlan {
    const region = clampPreviewRegion(request?.region);
    const requestedWidth = Number.isFinite(request?.outputWidth)
        ? Math.round(request?.outputWidth as number)
        : DEFAULT_OUTPUT_WIDTH;
    const width = Math.min(
        MAX_OUTPUT_WIDTH,
        Math.max(MIN_OUTPUT_WIDTH, requestedWidth)
    );
    const aspect = region
        ? (region.width * SOURCE_ASPECT) / region.height
        : SOURCE_ASPECT;
    const height = Math.min(
        MAX_OUTPUT_HEIGHT,
        Math.max(MIN_OUTPUT_HEIGHT, Math.round(width / aspect))
    );

    const filters = region
        ? [
              `crop=iw*${fraction(region.width)}:ih*${fraction(region.height)}:iw*${fraction(region.x)}:ih*${fraction(region.y)}`,
              `fps=${PREVIEW_FRAMES_PER_SECOND}`,
          ]
        : [`fps=${PREVIEW_FRAMES_PER_SECOND}`];

    return {
        bounds: { x: 0, y: 0, width, height },
        region,
        options: [
            // Nothing is heard from this session and no audio is decoded.
            'ao=null',
            'aid=no',
            'mute=yes',
            // Software filters need frames in system memory.
            'hwdec=auto-copy',
            `vf=lavfi=[${filters.join(',')}]`,
            // A tiny picture must not hold large buffers.
            'demuxer-max-bytes=8MiB',
            'demuxer-max-back-bytes=1MiB',
        ],
    };
}
