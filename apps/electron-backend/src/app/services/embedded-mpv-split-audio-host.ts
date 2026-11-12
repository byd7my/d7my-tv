import type { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';
import type { EmbeddedMpvSessionOptions } from './embedded-mpv-session-options';
import type { SoundSnapshot, SplitAudioHost } from './embedded-mpv-split-audio';
import type { SplitAudioManagerDeps } from './embedded-mpv-split-audio-manager';

/**
 * The pair's way to the sessions (see SplitAudioHost): every call goes
 * through the service's own session functions, so the sound session is a
 * session like any other (reconnect, snapshots, disposal) and the manager is
 * the only owner of when it exists.
 */
export function createSplitAudioHost(
    deps: SplitAudioManagerDeps,
    permitOptions: EmbeddedMpvSessionOptions,
    plan: { bounds: EmbeddedMpvBounds; options: string[] }
): SplitAudioHost {
    const readSound = (id: string): SoundSnapshot | null => {
        const snap = deps.addon().getSessionSnapshot(id);
        if (!snap) return null;
        return {
            status: snap.status,
            positionSeconds: snap.positionSeconds,
            bufferedAheadSeconds: snap.stats?.bufferedAheadSeconds ?? null,
            droppedFrames: snap.stats?.droppedFrames ?? null,
            bitrateBps:
                snap.stats?.videoBitrateBps !== undefined ||
                snap.stats?.audioBitrateBps !== undefined
                    ? (snap.stats?.videoBitrateBps ?? 0) +
                      (snap.stats?.audioBitrateBps ?? 0)
                    : null,
        };
    };
    const soundOptions = [...permitOptions.extraOptions, ...plan.options];
    let soundId: string | null = null;
    return {
        now: () => deps.now(),
        createSoundSession: () => {
            soundId = deps.createSession(plan.bounds, '', 0, {
                extraOptions: soundOptions,
                autoReconnect: true,
            });
            return soundId;
        },
        load: (id, playback) => deps.loadPlayback(id, playback),
        setPaused: (id, paused) => deps.setPaused(id, paused),
        seekBy: (id, delta) => deps.seekBy(id, delta),
        hold: (id, on) => deps.addon().setPaused(id, on),
        jump: (id, delta) => {
            const addon = deps.addon();
            if (addon.seekBy) return addon.seekBy(id, delta);
            const at = addon.getSessionSnapshot(id)?.positionSeconds ?? 0;
            addon.seek(id, Math.max(0, at + delta));
        },
        cacheOptions: (id) =>
            id === soundId ? soundOptions : permitOptions.extraOptions,
        setSpeed: (id, speed) => deps.addon().setSpeed(id, speed),
        setVolume: (id, volume) => deps.addon().setVolume(id, volume),
        disposeSession: (id) => deps.disposeSession(id),
        snapshot: (id) => readSound(id),
    };
}
