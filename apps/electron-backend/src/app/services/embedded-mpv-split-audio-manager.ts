import type {
    EmbeddedMpvBounds,
    EmbeddedMpvFrameRegion,
    EmbeddedMpvSession,
    EmbeddedMpvSplitAudioNotice,
    ResolvedPortalPlayback,
    SplitAudioSyncAction,
} from '@iptvnator/shared/interfaces';
import {
    SOUND_REPLACE_SETTLE_MS,
    soundSessionPlan,
    type SplitAudioAddon,
} from './embedded-mpv-split-audio-addon';
import type { EmbeddedMpvSessionOptions } from './embedded-mpv-session-options';
import {
    SplitAudioPair,
    type SplitAudioSyncMode,
} from './embedded-mpv-split-audio';
import { decoratePayload } from './split-audio-pair-status';
import { createSplitAudioHost } from './embedded-mpv-split-audio-host';

export {
    SOUND_REPLACE_SETTLE_MS,
    toSplitAudioAddon,
} from './embedded-mpv-split-audio-addon';
export type { SplitAudioAddon } from './embedded-mpv-split-audio-addon';

/**
 * Owns the main-session -> sound-session pairs of the two-session "audio from
 * another channel" mode and is the only place the native service talks to
 * about it. The service passes each user command through here; a command that
 * belongs to a pair is handled (and the service skips its own handling), any
 * other returns false and takes the unchanged audio-add path.
 */

/** Delay the frame-copy picture path adds to the picture, seconds (estimate). */
export const DEFAULT_SPLIT_AUDIO_D_BASE_SECONDS = 0.08;

export interface SplitAudioManagerDeps {
    addon(): SplitAudioAddon;
    /** True when the frame-copy engine is the active one. */
    usesFrameCopy(): boolean;
    now(): number;
    createSession(
        bounds: EmbeddedMpvBounds,
        title: string,
        initialVolume: number,
        options: EmbeddedMpvSessionOptions
    ): string;
    loadPlayback(sessionId: string, playback: ResolvedPortalPlayback): void;
    setPaused(sessionId: string, paused: boolean): void;
    seekBy(sessionId: string, deltaSeconds: number): void;
    disposeSession(sessionId: string): void;
    warn(message: string, error?: unknown): void;
}

interface Permit {
    /** The user's choice of the picture's own audio while the sound is frozen. */
    freezeAudio?: boolean;
    dBaseSeconds: number;
    options: EmbeddedMpvSessionOptions;
}

export class EmbeddedMpvSplitAudioManager {
    private readonly permits = new Map<string, Permit>();
    private readonly pairs = new Map<string, SplitAudioPair>();
    private readonly soundToMain = new Map<string, string>();
    private readonly failures = new Map<
        string,
        { message: string; notice: EmbeddedMpvSplitAudioNotice }
    >();
    /** Sync mode the user chose per main session; survives a replaced sound. */
    private readonly modes = new Map<string, SplitAudioSyncMode>();
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly regions = new Map<string, EmbeddedMpvFrameRegion | null>();
    /**
     * The user's volume and speed while a replacement sound is on its way. The picture session is muted (and may be slowed by the
     * sync factor) in that gap, so its snapshot is not what the user chose.
     */
    private readonly carried = new Map<
        string,
        { volume: number; speed: number }
    >();

    constructor(private readonly deps: SplitAudioManagerDeps) {}

    /** Called when a main session is created with the feature switched on. */
    allow(
        mainId: string,
        options: EmbeddedMpvSessionOptions,
        dBaseSeconds = DEFAULT_SPLIT_AUDIO_D_BASE_SECONDS
    ): void {
        this.permits.set(mainId, { dBaseSeconds, options });
    }

    pairOf(sessionId: string): SplitAudioPair | undefined {
        return this.pairs.get(sessionId);
    }

    isSoundSession(sessionId: string): boolean {
        return this.soundToMain.has(sessionId);
    }

    /** What a reload of `sessionId` must leave it: paused only for the user's pause. */
    pausedAfterReload(sessionId: string): boolean {
        const pair = this.pairs.get(
            this.soundToMain.get(sessionId) ?? sessionId
        );
        return pair?.paused ?? false;
    }

    // ------------------------------------------------------------ audio add

    /** Returns true when the pair handled the request (audio-add must not). */
    setExternalAudio(
        mainId: string,
        playback: ResolvedPortalPlayback | null,
        delaySeconds: number
    ): boolean {
        const permit = this.permits.get(mainId);
        const existing = this.pairs.get(mainId);
        if (!playback) {
            if (!existing) return false;
            this.stop(mainId);
            return true;
        }
        if (!permit || !this.deps.usesFrameCopy()) return false;
        this.failures.delete(mainId);
        this.cancelPending(mainId);
        if (existing) {
            // Another channel, or the same one cropped differently: the old
            // connection closes first, the picture stays muted meanwhile.
            this.carried.set(mainId, {
                volume: existing.volume,
                speed: existing.speed,
            });
            this.stop(mainId, false);
            this.pending.set(
                mainId,
                setTimeout(() => {
                    this.pending.delete(mainId);
                    if (
                        !this.startPair(mainId, permit, playback, delaySeconds)
                    ) {
                        this.restoreCarried(mainId);
                        this.failOpen(mainId);
                    }
                }, SOUND_REPLACE_SETTLE_MS)
            );
            return true;
        }
        if (this.soundSessionOf(mainId) !== null) {
            // Never a second sound session, and never the audio-add path
            // (it opens its own connections) while the pair mode is on.
            this.failOpen(mainId);
            return true;
        }
        return this.startPair(mainId, permit, playback, delaySeconds);
    }

    private startPair(
        mainId: string,
        permit: Permit,
        playback: ResolvedPortalPlayback,
        delaySeconds: number
    ): boolean {
        // One sound session per picture, always: the connections are the
        // picture's and the sound's, and a replacement closes the old one
        // before this runs.
        if (this.pairs.has(mainId) || this.soundSessionOf(mainId) !== null) {
            this.deps.warn(
                `Two-session audio refused a second sound session for ${mainId}.`
            );
            return false;
        }
        const host = createSplitAudioHost(
            this.deps,
            permit.options,
            soundSessionPlan(playback)
        );
        const snap = this.deps.addon().getSessionSnapshot(mainId);
        const carry = this.carried.get(mainId);
        this.carried.delete(mainId);
        const pair = new SplitAudioPair(
            host,
            {
                mainId,
                syncMode: this.modes.get(mainId) ?? 'auto',
                userSpeed: carry?.speed ?? snap?.playbackSpeed ?? 1,
                userVolume: carry?.volume ?? snap?.volume ?? 1,
                paused: snap?.status === 'paused',
                dBaseSeconds: permit.dBaseSeconds,
                trimSeconds: delaySeconds,
            },
            {
                // Not inside the pair's own tick: the pair is taken apart.
                giveUp: () =>
                    setTimeout(
                        () =>
                            this.fail(
                                mainId,
                                'The audio channel stalled twice within five minutes; the original channel audio was restored.',
                                'stalled'
                            ),
                        0
                    ),
            }
        );
        pair.setOriginalAudioDuringFreeze(permit.freezeAudio ?? false);
        try {
            const soundId = pair.start(playback);
            this.regions.set(mainId, playback.clockRegion ?? null);
            this.pairs.set(mainId, pair);
            this.soundToMain.set(soundId, mainId);
            return true;
        } catch (error) {
            this.deps.warn(
                'Two-session audio could not start; using the audio-add path.',
                error
            );
            this.abandon(pair);
            return false;
        }
    }

    setExternalAudioDelay(mainId: string, delaySeconds: number): boolean {
        const pair = this.pairs.get(mainId);
        if (!pair) return false;
        pair.setTrim(delaySeconds);
        return true;
    }

    // ------------------------------------------------------- user commands

    onSetPaused(mainId: string, paused: boolean): void {
        this.pairs.get(mainId)?.onPause(paused);
    }

    onSeekBy(mainId: string, deltaSeconds: number): void {
        this.pairs.get(mainId)?.onSeekBy(deltaSeconds);
    }

    onSeekTo(mainId: string, targetSeconds: number): void {
        const pair = this.pairs.get(mainId);
        if (!pair) return;
        const snap = this.deps.addon().getSessionSnapshot(mainId);
        pair.onSeekBy(targetSeconds - (snap?.positionSeconds ?? targetSeconds));
    }

    /** True when the pair applied the speed (user speed x sync factor). */
    onSetSpeed(mainId: string, speed: number): boolean {
        const carry = this.carried.get(mainId);
        if (carry) {
            carry.speed = speed;
            return true;
        }
        const pair = this.pairs.get(mainId);
        if (!pair) return false;
        pair.setUserSpeed(speed);
        return true;
    }

    /** True when the pair applied the volume (the sound session plays it). */
    onSetVolume(mainId: string, volume: number): boolean {
        const carry = this.carried.get(mainId);
        if (carry) {
            carry.volume = volume;
            return true;
        }
        const pair = this.pairs.get(mainId);
        if (!pair) return false;
        pair.setUserVolume(volume);
        return true;
    }

    /** A user-driven load replaces the picture the sound belonged to. */
    onUserLoad(mainId: string): void {
        this.cancelPending(mainId);
        if (this.pairs.has(mainId)) this.stop(mainId);
    }

    onDispose(sessionId: string): void {
        const mainId = this.soundToMain.get(sessionId);
        if (mainId) {
            // The sound session is gone: the pair cannot go on.
            this.soundToMain.delete(sessionId);
            const pair = this.pairs.get(mainId);
            if (pair) pair.soundId = null;
            this.fail(
                mainId,
                'The audio channel session ended.',
                'channel-lost'
            );
            return;
        }
        this.cancelPending(sessionId);
        if (this.pairs.has(sessionId)) this.stop(sessionId);
        this.regions.delete(sessionId);
        this.permits.delete(sessionId);
        this.failures.delete(sessionId);
        this.modes.delete(sessionId);
    }

    /** Measurement from the renderer: lateness of the sound, seconds. */
    report(mainId: string, lateness: number, manual: boolean): boolean {
        const pair = this.pairs.get(mainId);
        if (!pair) return false;
        pair[manual ? 'reportManualLateness' : 'reportLateness'](lateness);
        return true;
    }

    /** Auto (clock readings) or manual (typed offset): the one decision source. */
    setSyncMode(mainId: string, mode: SplitAudioSyncMode): boolean {
        if (!this.permits.has(mainId)) return false;
        this.modes.set(mainId, mode);
        this.pairs.get(mainId)?.setSyncMode(mode);
        return true;
    }

    /**
     * The clock preview is a third session. While the two-session mode is on
     * the sound session already shows the clock, so no preview may open: the
     * limit is the picture and the sound, two connections.
     */
    previewAllowed(): boolean {
        return this.permits.size === 0 && this.pairs.size === 0;
    }

    /** The user's sync buttons: Auto Sync (start/cancel) and Quick sync. */
    syncAction(mainId: string, action: SplitAudioSyncAction): boolean {
        const pair = this.pairs.get(mainId);
        if (!pair) return false;
        const permit = this.permits.get(mainId);
        if (permit && action.startsWith('original-audio')) {
            // Kept with the permit: it survives a replaced sound.
            permit.freezeAudio = action === 'original-audio-on';
        }
        return pair.syncAction(action);
    }

    setAuto(mainId: string, on: boolean): boolean {
        const pair = this.pairs.get(mainId);
        if (!pair) return false;
        pair.setAutoCorrection(on);
        return true;
    }

    // ---------------------------------------------------------- observation

    /** Every poll (about twice a second). */
    tick(): void {
        for (const [mainId, pair] of this.pairs) {
            try {
                pair.tick();
            } catch (error) {
                this.deps.warn(
                    `Two-session audio tick failed for ${mainId}.`,
                    error
                );
            }
        }
    }

    /** From each session's refresh: status transitions drive resets. */
    onStatus(
        sessionId: string,
        status: string,
        previous: string | null,
        hasReconnect: boolean
    ): void {
        const mainId = this.soundToMain.get(sessionId);
        if (mainId) {
            if (status === 'error' && !hasReconnect) {
                // Not inside the sound session's own refresh: it is disposed.
                setTimeout(
                    () =>
                        this.fail(
                            mainId,
                            'The audio channel stopped and could not be reloaded.',
                            'channel-lost'
                        ),
                    0
                );
            } else if (status === 'playing' && previous !== 'playing') {
                const pair = this.pairs.get(mainId);
                // The sound's own resume after a sync freeze is not a reload.
                if (!pair?.ownsTransition('sound')) pair?.onSoundReloaded();
            }
            return;
        }
        if (status === 'playing' && previous !== 'playing') {
            const pair = this.pairs.get(sessionId);
            // Likewise the picture's resume after a sync freeze.
            if (!pair?.ownsTransition('picture')) pair?.onMainReloaded();
        }
    }

    /** Overrides what the picture session reports with what the pair means. */
    decorate(payload: EmbeddedMpvSession): void {
        const pair = this.pairs.get(payload.id);
        if (pair) {
            decoratePayload(
                pair,
                payload,
                this.regions.get(payload.id) ?? null
            );
        }
        if (this.permits.has(payload.id)) payload.splitAudioEnabled = true;
        const failure = this.failures.get(payload.id);
        if (failure) {
            payload.splitAudioNotice = failure.notice;
            if (!payload.externalAudioError) {
                payload.externalAudioError = failure.message;
            }
        }
    }

    // ------------------------------------------------------------ internals

    /** Ends the pair and hands the main session back its sound and speed. */
    private stop(mainId: string, restoreMain = true): void {
        const pair = this.pairs.get(mainId);
        if (!pair) return;
        this.pairs.delete(mainId);
        if (pair.soundId) this.soundToMain.delete(pair.soundId);
        try {
            pair.stop(restoreMain);
        } catch (error) {
            this.deps.warn(
                `Two-session audio stop failed for ${mainId}.`,
                error
            );
        }
    }

    /** The sound is gone for good: give the picture its own sound back. */
    private fail(
        mainId: string,
        message: string,
        notice: EmbeddedMpvSplitAudioNotice
    ): void {
        this.failures.set(mainId, { message, notice });
        this.stop(mainId);
    }

    private failOpen(mainId: string): void {
        this.fail(
            mainId,
            'The audio channel could not be opened.',
            'open-failed'
        );
    }

    private soundSessionOf(mainId: string): string | null {
        for (const [soundId, owner] of this.soundToMain) {
            if (owner === mainId) return soundId;
        }
        return null;
    }

    private cancelPending(mainId: string): void {
        const timer = this.pending.get(mainId);
        if (timer === undefined) return;
        clearTimeout(timer);
        this.pending.delete(mainId);
        this.carried.delete(mainId);
    }

    /** A replacement that never started: the muted picture gets the user's volume and speed back. */
    private restoreCarried(mainId: string): void {
        const carry = this.carried.get(mainId);
        this.carried.delete(mainId);
        if (!carry) return;
        try {
            this.deps.addon().setVolume(mainId, carry.volume);
            this.deps.addon().setSpeed(mainId, carry.speed);
        } catch {
            // the picture session may already be gone
        }
    }

    private abandon(pair: SplitAudioPair): void {
        const soundId = pair.soundId;
        if (!soundId) return;
        this.soundToMain.delete(soundId);
        try {
            pair.stop();
        } catch {
            // already reported by the caller
        }
    }
}
