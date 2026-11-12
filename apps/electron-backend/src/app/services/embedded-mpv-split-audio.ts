import type {
    EmbeddedMpvSplitAudioStatus,
    ResolvedPortalPlayback,
    SplitAudioSyncAction,
} from '@iptvnator/shared/interfaces';
import { FreezeHolds, RESUME_GRACE_MS } from './split-audio-freeze-holds';
import { runQuickSync } from './split-audio-quick-sync';
import { SoundWatch } from './split-audio-sound-watch';
import { createRunIO } from './split-audio-run-io';
import { SyncCorrector } from './split-audio-corrector';
import type { AudioIssue } from './split-audio-health';
import { AutoSyncRun, type SyncSide } from './split-audio-sync-run';
import { buildSplitAudioStatus } from './split-audio-pair-status';

/**
 * "Audio from another channel" with two sessions: the main session keeps the
 * picture (muted) and a second, hidden session plays the other channel's
 * sound. This class owns the link between them:
 *
 *  - every control the user gives the player reaches both (pause, seek, speed,
 *    volume), so the pair behaves like one player;
 *  - the user's speed and the sync correction are separate numbers. The speed
 *    each session really gets is `userSpeed x factor` (factor: 1 or a small
 *    slowdown from the corrector), so a correction never changes what the
 *    user chose and the user's choice never cancels a correction;
 *  - the target the correction aims at is `D_base + trim`: D_base is the fixed
 *    delay of the frame-copy picture path, trim is the user's fine delay. The
 *    sound session's own `audio-delay` is never used (it moves the hidden
 *    picture, not what is heard);
 *  - pause, seek, reload and reconnect void the measurement: factors go back
 *    to 1 and the lateness is measured again;
 *  - the pair has ONE decision source, chosen by `syncMode`: in 'auto' only
 *    the readings taken off the two match clocks steer the corrector, in
 *    'manual' only the offset the user typed does. The other source is
 *    ignored, and the corrector is the only thing that ever changes a speed
 *    (the user's trim moves its target, never a speed);
 *  - the sound is watched all the time. The first reliable fault (a stall, a
 *    starved buffer, a speed mpv does not follow, dropped frames) voids the
 *    measurement and gives both sessions the user's speed back, whichever one
 *    was slowed. A second one within the policy window gives the external
 *    sound up: `hooks.giveUp` makes the owner close the sound session and hand
 *    the picture its own audio back.
 *
 * It talks to mpv only through `SplitAudioHost`, so the whole thing is unit
 * tested without a helper process.
 */
export interface SoundSnapshot {
    status: string;
    positionSeconds: number;
    bufferedAheadSeconds: number | null;
    droppedFrames: number | null;
    /** Video + audio bitrate mpv measured, bits per second. */
    bitrateBps?: number | null;
}

export interface SplitAudioHost {
    now(): number;
    createSoundSession(): string;
    load(sessionId: string, playback: ResolvedPortalPlayback): void;
    setPaused(sessionId: string, paused: boolean): void;
    /**
     * Pauses/resumes a session for the sync freeze only. It never goes through
     * the user's pause path (the pair would take it for the user's pause).
     */
    hold(sessionId: string, on: boolean): void;
    /** `key=value` options the session was started with (cache limits). */
    cacheOptions(sessionId: string): readonly string[];
    seekBy(sessionId: string, deltaSeconds: number): void;
    /** A jump of one session only, not the user's seek (it never reaches the pair). */
    jump(sessionId: string, deltaSeconds: number): void;
    setSpeed(sessionId: string, speed: number): void;
    setVolume(sessionId: string, volume: number): void;
    disposeSession(sessionId: string): void;
    snapshot(sessionId: string): SoundSnapshot | null;
}

export type SplitAudioSyncMode = 'auto' | 'manual';

export interface SplitAudioHooks {
    /** The sound kept failing: the owner must end the pair. */
    giveUp(issue: AudioIssue): void;
}

export interface SplitAudioInit {
    mainId: string;
    syncMode?: SplitAudioSyncMode;
    userSpeed: number;
    userVolume: number;
    paused: boolean;
    /** Fixed delay of the frame-copy picture path, seconds. */
    dBaseSeconds: number;
    trimSeconds: number;
}

/** Quiet time before the lateness is judged again, by cause. */
export { RESUME_GRACE_MS };
export const SETTLE_MS = { pause: 3000, seek: 4000, reload: 5000 } as const;
const QUICK_SHOWN_MS = 15000;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

export function clampSpeed(speed: number): number {
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

function round5(value: number): number {
    return Math.round(value * 1e5) / 1e5;
}

export class SplitAudioPair {
    readonly mainId: string;
    soundId: string | null = null;
    private userSpeed: number;
    private userVolume: number;
    private userPaused: boolean;
    private trimSeconds: number;
    private readonly dBaseSeconds: number;
    private appliedMain = NaN;
    private appliedSound = NaN;
    private speedChangedAt = 0;
    private syncMode: SplitAudioSyncMode;
    private autoOn = true;
    private disabledReason: string | null = null;
    private readonly corrector = new SyncCorrector();
    private readonly watch = new SoundWatch();
    private readonly run: AutoSyncRun;
    private fineOn = false;
    private readonly holds: FreezeHolds;
    private lastReading: { value: number; at: number } | null = null;
    private manualVoided: EmbeddedMpvSplitAudioStatus['manualVoided'] = null;
    private quick: EmbeddedMpvSplitAudioStatus['quickSync'] = null;
    private quickAt = 0;
    private startedAt = 0;

    constructor(
        private readonly host: SplitAudioHost,
        init: SplitAudioInit,
        private readonly hooks: SplitAudioHooks = { giveUp: () => undefined }
    ) {
        this.mainId = init.mainId;
        this.syncMode = init.syncMode ?? 'auto';
        this.userSpeed = clampSpeed(init.userSpeed);
        this.userVolume = init.userVolume;
        this.userPaused = init.paused;
        this.trimSeconds = init.trimSeconds;
        this.dBaseSeconds = init.dBaseSeconds;
        this.corrector.setTarget(this.target());
        this.corrector.setSpeed(this.userSpeed, host.now());
        this.holds = new FreezeHolds(
            host,
            this.mainId,
            () => this.soundId,
            () => this.userVolume,
            () => this.userPaused
        );
        this.run = new AutoSyncRun(
            createRunIO({
                host,
                mainId: this.mainId,
                soundId: () => this.soundId,
                target: () => this.target(),
                userSpeed: () => this.userSpeed,
                corrector: this.corrector,
                hold: (side, on) => this.holds.hold(side, on),
                setFine: (on, now) => this.setFine(on, now),
                giveUp: () => this.hooks.giveUp('stall'),
            })
        );
    }

    // ------------------------------------------------------------ lifecycle

    start(playback: ResolvedPortalPlayback): string {
        const id = this.host.createSoundSession();
        this.soundId = id;
        this.host.setVolume(id, this.userVolume);
        this.host.load(id, playback);
        this.speedChangedAt = this.host.now();
        this.startedAt = this.speedChangedAt;
        // The picture is muted for as long as the pair lives.
        this.host.setVolume(this.mainId, 0);
        this.applySpeeds(true);
        if (this.userPaused) this.host.setPaused(id, true);
        this.resetSync('reload');
        return id;
    }

    /**
     * Hands the session back as it was: its own speed and volume. With
     * `restoreMain` false the picture stays muted (a replacement sound is on
     * its way).
     */
    stop(restoreMain = true): void {
        // A frozen picture must never be left frozen.
        this.run.cancel(null);
        const id = this.soundId;
        this.soundId = null;
        try {
            this.host.setSpeed(this.mainId, this.userSpeed);
            if (restoreMain) this.host.setVolume(this.mainId, this.userVolume);
        } catch {
            // the main session may already be gone
        }
        if (id) this.host.disposeSession(id);
    }

    // ------------------------------------------------------------- controls

    setUserSpeed(speed: number): void {
        this.userSpeed = clampSpeed(speed);
        this.corrector.setSpeed(this.userSpeed, this.host.now());
        this.applySpeeds(true);
    }

    setUserVolume(volume: number): void {
        this.userVolume = volume;
        if (this.soundId) this.host.setVolume(this.soundId, volume);
        this.holds.onVolume(volume);
    }

    get volume(): number {
        return this.userVolume;
    }

    get speed(): number {
        return this.userSpeed;
    }

    get paused(): boolean {
        return this.userPaused;
    }

    setTrim(seconds: number): void {
        this.trimSeconds = Number.isFinite(seconds) ? seconds : 0;
        this.corrector.setTarget(this.target());
    }

    /**
     * Auto or manual. A change throws away what the other source measured and
     * lets the speeds go; the new source starts from nothing.
     */
    setSyncMode(mode: SplitAudioSyncMode): void {
        if (mode === this.syncMode) return;
        this.syncMode = mode;
        this.manualVoided = null;
        this.resetSync('reload');
    }

    get mode(): SplitAudioSyncMode {
        return this.syncMode;
    }

    setAutoCorrection(on: boolean): void {
        this.autoOn = on;
        if (on) {
            this.disabledReason = null;
            this.watch.policy.reset();
            this.resetSync('reload');
        } else {
            this.run.cancel(null);
            this.releaseFactors();
        }
    }

    onPause(paused: boolean): void {
        this.userPaused = paused;
        if (this.soundId) this.host.setPaused(this.soundId, paused);
        this.resetSync('pause');
    }

    /** The main picture jumped by `deltaSeconds`; the sound follows it. */
    onSeekBy(deltaSeconds: number): void {
        if (
            this.soundId &&
            Number.isFinite(deltaSeconds) &&
            deltaSeconds !== 0
        ) {
            this.host.seekBy(this.soundId, deltaSeconds);
        }
        this.resetSync('seek');
    }

    /** The main session loaded a stream, by the user or by a reconnect. */
    onMainReloaded(): void {
        this.resetSync('reload');
    }

    /**
     * The sound session reloaded after a drop. mpv's keep-open parks it paused
     * at the end of the old stream and the reload would inherit that: it has
     * to be unpaused, but only when the user is not paused.
     */
    onSoundReloaded(): void {
        if (!this.soundId) return;
        this.host.setPaused(this.soundId, this.userPaused);
        this.applySpeeds(true);
        this.resetSync('reload');
    }

    // ----------------------------------------------------------- correction

    /**
     * Lateness read off the two match clocks: positive when the sound is
     * behind. Only the automatic mode listens to it, and only a started run
     * (or its fine correction) acts on it.
     */
    reportLateness(seconds: number): void {
        if (this.syncMode !== 'auto' || !this.autoOn || this.userPaused) return;
        this.lastReading = { value: seconds, at: this.host.now() };
        this.run.addReading(seconds);
        if (this.fineOn) this.corrector.addReading(seconds, this.host.now());
    }

    /** One lateness the user typed; steers by dead reckoning. Manual mode only. */
    reportManualLateness(seconds: number): void {
        if (this.syncMode === 'manual' && this.autoOn && !this.userPaused) {
            this.manualVoided = null;
            this.corrector.setManual(seconds, this.host.now());
        }
    }

    // ---------------------------------------------------- the automatic run

    /** The user pressed Sync: one run, from measuring to "synced" or "failed". */
    startAutoSync(): boolean {
        if (
            this.syncMode !== 'auto' ||
            !this.autoOn ||
            this.userPaused ||
            !this.soundId
        ) {
            return false;
        }
        const now = this.host.now();
        this.corrector.reset(now, 0);
        this.releaseFactors();
        this.fineOn = false;
        this.quick = null;
        return this.run.start();
    }

    cancelAutoSync(): void {
        this.run.cancel(null);
    }

    /** The user's sync buttons (see `SplitAudioSyncAction`). */
    syncAction(action: SplitAudioSyncAction): boolean {
        switch (action) {
            case 'start':
                return this.startAutoSync();
            case 'cancel':
                this.cancelAutoSync();
                break;
            case 'quick':
                this.quickSync();
                break;
            default:
                this.setOriginalAudioDuringFreeze(
                    action === 'original-audio-on'
                );
        }
        return true;
    }

    /** True while a freeze (or the resume of one) explains a session's status. */
    ownsTransition(side: SyncSide): boolean {
        return this.holds.owns(side);
    }

    /** The picture is held on purpose: it must not look paused. */
    get pictureFrozen(): boolean {
        return this.run.pictureFrozen;
    }

    /** The user's choice: the picture's own audio plays while the sound is frozen. */
    setOriginalAudioDuringFreeze(on: boolean): void {
        this.holds.setOriginalAudio(on);
    }

    /**
     * "Quick sync", only ever on the user's button: the session that is ahead
     * jumps back by the difference. It needs a reading, the history to jump
     * into and a cache that really keeps that much behind the playhead.
     */
    quickSync(): NonNullable<EmbeddedMpvSplitAudioStatus['quickSync']> {
        const now = this.host.now();
        const fresh = this.lastReading && now - this.lastReading.at <= 6000;
        const result = runQuickSync({
            host: this.host,
            mainId: this.mainId,
            soundId: this.soundId,
            userPaused: this.userPaused,
            lateness:
                this.syncMode === 'manual'
                    ? this.corrector.state.lateness
                    : fresh
                      ? (this.lastReading?.value ?? null)
                      : null,
            target: this.target(),
            startedAt: this.startedAt,
            beforeJump: () => this.run.cancel(null),
            afterJump: () => this.resetSync('seek'),
        });
        this.quick = result;
        this.quickAt = now;
        return result;
    }

    /** Called about twice a second. */
    tick(): void {
        const id = this.soundId;
        if (!id) return;
        const now = this.host.now();
        this.watchSound(id, now);
        if (!this.autoOn || this.userPaused) return;
        if (this.syncMode === 'auto') this.run.tick();
        if (
            (this.syncMode === 'manual' || this.fineOn) &&
            this.corrector.step(now)
        ) {
            this.applySpeeds(false);
        }
    }

    status(): EmbeddedMpvSplitAudioStatus {
        const now = this.host.now();
        return buildSplitAudioStatus({
            syncMode: this.syncMode,
            autoOn: this.autoOn,
            userPaused: this.userPaused,
            correction: this.corrector.state,
            factors: this.corrector.factors,
            run: this.run.status(),
            soundId: this.soundId ?? '',
            userSpeed: this.userSpeed,
            clamp: clampSpeed,
            targetSeconds: this.target(),
            dBaseSeconds: this.dBaseSeconds,
            trimSeconds: this.trimSeconds,
            audioRate: this.watch.audioRate,
            issue: this.watch.shownIssue(now),
            disabledReason: this.disabledReason,
            manualVoided: this.manualVoided,
            originalAudioDuringFreeze: this.holds.originalAudio,
            quick: now - this.quickAt < QUICK_SHOWN_MS ? this.quick : null,
        });
    }

    // ------------------------------------------------------------ internals

    private target(): number {
        return this.dBaseSeconds + this.trimSeconds;
    }

    private resetSync(cause: keyof typeof SETTLE_MS): void {
        this.voidManual(cause);
        this.run.cancel('interrupted');
        this.fineOn = false;
        this.corrector.reset(this.host.now(), SETTLE_MS[cause]);
        this.watch.reset();
        this.releaseFactors();
    }

    /**
     * A manual correction that was under way ends here. It is not applied
     * again by itself: the user is told and decides (the value is still typed).
     */
    private voidManual(
        cause: NonNullable<EmbeddedMpvSplitAudioStatus['manualVoided']>
    ): void {
        if (
            this.syncMode === 'manual' &&
            this.corrector.state.active !== null
        ) {
            this.manualVoided = cause;
        }
    }

    /** The fine correction of a run starts or stops (stopping gives the user's speed back). */
    private setFine(on: boolean, now: number): void {
        this.fineOn = on;
        this.corrector.reset(now, 0);
        if (on) this.applySpeeds(false);
        else this.releaseFactors();
    }

    private releaseFactors(): void {
        this.applySpeeds(false);
    }

    /** Sends `userSpeed x factor` to both sessions, only what changed. */
    private applySpeeds(force: boolean): void {
        const f = this.autoOn ? this.corrector.factors : { main: 1, sound: 1 };
        const main = round5(clampSpeed(this.userSpeed * f.main));
        const sound = round5(clampSpeed(this.userSpeed * f.sound));
        if (force || main !== this.appliedMain) {
            this.appliedMain = main;
            this.host.setSpeed(this.mainId, main);
            this.speedChangedAt = this.host.now();
        }
        if (this.soundId && (force || sound !== this.appliedSound)) {
            this.appliedSound = sound;
            this.host.setSpeed(this.soundId, sound);
            this.speedChangedAt = this.host.now();
        }
    }

    private watchSound(id: string, now: number): void {
        const snap = this.host.snapshot(id);
        if (!snap) return;
        const issue = this.watch.observe(snap, {
            now,
            speed: this.appliedSound,
            held: this.holds.isHeld('sound'),
            userPaused: this.userPaused,
            steadySeconds: (now - this.speedChangedAt) / 1000,
        });
        if (!issue) return;
        // A reliable fault, whichever session is the slowed one: what was
        // measured no longer holds, so it is voided (the corrector stops and
        // waits) and both sessions get the user's speed back.
        const action = this.watch.policy.onIssue(now);
        this.voidManual('fault');
        this.run.cancel('faulted');
        this.fineOn = false;
        this.corrector.reset(now, this.watch.policy.holdMs);
        this.watch.clearHealth();
        this.applySpeeds(true);
        if (action === 'give-up') {
            this.autoOn = false;
            this.disabledReason = issue;
            this.hooks.giveUp(issue);
        }
    }
}
