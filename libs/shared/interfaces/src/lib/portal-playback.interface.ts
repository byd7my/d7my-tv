import { ChannelDrm } from './channel-drm.interface';
import type { EmbeddedMpvFrameRegion } from './embedded-mpv-session.interface';
import { PlaybackPositionData } from './playback-position.interface';

export interface PlayerContentInfo extends Omit<
    PlaybackPositionData,
    'positionSeconds' | 'durationSeconds' | 'updatedAt'
> {
    playlistId: string;
}

export interface ResolvedPortalPlayback {
    streamUrl: string;
    /** Source-owner supplied, advertised TS alternative for Xtream live Auto only. */
    liveAutoTsUrl?: string;
    title: string;
    thumbnail?: string | null;
    isLive?: boolean;
    startTime?: number;
    contentInfo?: PlayerContentInfo;
    headers?: Record<string, string>;
    userAgent?: string;
    referer?: string;
    origin?: string;
    drm?: ChannelDrm;
    /**
     * Audio taken from another channel only: where that channel's match
     * clock is (fractions of the frame). The two-session mode crops its hidden
     * picture to it so the clock can be read without a third session.
     */
    clockRegion?: EmbeddedMpvFrameRegion;
}

/**
 * Audio taken from another stream while the picture plays from the main one
 * (e.g. another channel's commentary). `delaySeconds` shifts that audio
 * relative to the video; live streams rarely line up on their own.
 */
export interface ExternalAudioOverride {
    streamUrl: string;
    title?: string;
    delaySeconds?: number;
    headers?: Record<string, string>;
    userAgent?: string;
    referer?: string;
    origin?: string;
}
