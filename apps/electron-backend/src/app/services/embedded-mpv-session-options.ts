import { resolveEmbeddedMpvSessionOptionArguments } from '@iptvnator/shared/interfaces';
import {
    EMBEDDED_MPV_AUTO_RECONNECT,
    EMBEDDED_MPV_EXTRA_OPTIONS,
    EMBEDDED_MPV_SPLIT_AUDIO,
    EMBEDDED_MPV_SPLIT_AUDIO_D_BASE,
    store,
} from './store.service';

const SPLIT_AUDIO_ENV = 'IPTVNATOR_EMBEDDED_MPV_SPLIT_AUDIO';

function isSplitAudioEnvOn(): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
        (process.env[SPLIT_AUDIO_ENV] ?? '').toLowerCase()
    );
}

function readDBase(): number | undefined {
    const value = store.get(EMBEDDED_MPV_SPLIT_AUDIO_D_BASE, NaN);
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(0.5, Math.max(0, value))
        : undefined;
}

/**
 * Per-session knobs captured when an embedded MPV session is created. They
 * come from the main-process settings mirror (see `store.service.ts`), so a
 * settings change applies to the next session, never to a running one.
 *
 * Read here rather than inside `EmbeddedMpvNativeService`: the config store
 * is constructed at module load and would drag electron-conf into every
 * consumer of the service, including its unit tests.
 */
export interface EmbeddedMpvSessionOptions {
    /**
     * `key=value` lines the addon applies after its built-in options: the
     * network defaults first, then the user's allowed lines.
     */
    extraOptions: string[];
    /** Reload a dropped stream automatically (see `embedded-mpv-reconnect.ts`). */
    autoReconnect: boolean;
    /**
     * Play "audio from another channel" in a second, hidden session whose
     * speed is nudged to keep it in step with the picture, instead of mpv's
     * audio-add. Frame-copy engine only; off by default.
     */
    splitAudio?: boolean;
    /** Fixed delay of the frame-copy picture path, seconds (default 0.08). */
    splitAudioDBaseSeconds?: number;
}

export function readEmbeddedMpvSessionOptions(): EmbeddedMpvSessionOptions {
    return {
        extraOptions: resolveEmbeddedMpvSessionOptionArguments(
            store.get(EMBEDDED_MPV_EXTRA_OPTIONS, '')
        ),
        autoReconnect: store.get(EMBEDDED_MPV_AUTO_RECONNECT, true) !== false,
        splitAudio:
            isSplitAudioEnvOn() ||
            store.get(EMBEDDED_MPV_SPLIT_AUDIO, false) === true,
        splitAudioDBaseSeconds: readDBase(),
    };
}
