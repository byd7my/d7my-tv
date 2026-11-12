import {
    computed,
    effect,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import type { AudioSyncController } from '../audio-sync/audio-sync.controller';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
} from './player-controls.model';

export type SplitSyncMode = 'auto' | 'manual';
export type SplitSyncLead = 'picture' | 'audio';

/** Finest and coarse step of the typed offset, seconds. */
export const MANUAL_STEPS = [0.1, 1] as const;
const MAX_MANUAL_SECONDS = 600;
/** The run must show as working within this long after Sync, or it was refused. */
const START_CHECK_MS = 6000;

/**
 * The sync controls of the two-session audio mode, one place for both modes:
 *
 *  - Auto: the clocks of the two pictures are read in the background and the
 *    backend corrects the speed. The user's fine delay only moves the target.
 *  - Manual: the user types how far one side is ahead; the clock readings are
 *    not read at all (the reader is stopped, and the backend ignores them).
 *
 * The backend owns the decision: this only chooses which source it listens to
 * and feeds it. Create it in an injection context.
 */
export class ControlsSplitSync {
    /** Which source steers: the clock readings or the typed offset. */
    readonly mode = signal<SplitSyncMode>('auto');
    /** The user pressed "start sync" (the bar is shown). */
    readonly started = signal(false);
    /** Manual: how many seconds one side is ahead (always >= 0). */
    readonly manualSeconds = signal(0);
    /** Manual: which side is ahead. */
    readonly manualLead = signal<SplitSyncLead>('picture');
    /** Auto: the backend run has been seen working (so its end is real). */
    private sawActive = false;
    private startCheck: ReturnType<typeof setTimeout> | null = null;
    /** The user closed the notice of an ended external sound. */
    private readonly noticeDismissed = signal(false);

    readonly status = computed(() => this.state().splitAudio ?? null);
    readonly notice = computed(() =>
        this.noticeDismissed() ? null : (this.state().splitAudioNotice ?? null)
    );
    /** Where the automatic run is (null: not auto, or no pair yet). */
    readonly phase = computed(() => this.status()?.sync?.phase ?? null);
    /** The run is working: reading clocks, freezing or fine-tuning. */
    readonly running = computed(() => {
        const phase = this.phase();
        return (
            phase !== null &&
            phase !== 'idle' &&
            phase !== 'done' &&
            phase !== 'failed'
        );
    });
    /** The run ended (synced or failed): Sync can be pressed again. */
    readonly ended = computed(
        () => this.phase() === 'done' || this.phase() === 'failed'
    );
    /** The main button reads "Stop" while something runs; after a finished auto run it is "Sync now" again. */
    readonly stopShown = computed(
        () => this.started() && !(this.mode() === 'auto' && this.ended())
    );
    readonly originalAudio = computed(
        () => this.status()?.originalAudioDuringFreeze ?? false
    );
    readonly manualVoided = computed(() =>
        this.mode() === 'manual' ? (this.status()?.manualVoided ?? null) : null
    );
    /** The picture the sound is behind (positive) or ahead of (negative), seconds. */
    readonly manualLateness = computed(() =>
        this.manualLead() === 'picture'
            ? this.manualSeconds()
            : -this.manualSeconds()
    );
    /** The bar shows while sync runs, or to tell why the external sound ended. */
    readonly barVisible = computed(
        () =>
            (this.started() && this.active()) ||
            (this.notice() !== null && !this.active())
    );

    constructor(
        private readonly state: Signal<PlayerControlsState>,
        private readonly commands: () => PlayerControlsCommands | undefined,
        private readonly sync: AudioSyncController,
        /** An audio channel is chosen and the pair is on. */
        private readonly active: () => boolean,
        private readonly activeAudioUrl: Signal<string | null>
    ) {
        // The sound went away (cleared, failed, given up): nothing to sync.
        effect(() => {
            if (this.activeAudioUrl() === null) {
                untracked(() => this.reset());
            }
        });
        // The run ended by itself: nothing keeps reading the clocks (Auto Sync
        // is one run, not a monitor).
        effect(() => {
            const phase = this.phase();
            const running = this.running();
            untracked(() => {
                if (running) this.sawActive = true;
                else if (
                    this.sawActive &&
                    (phase === 'done' || phase === 'failed' || phase === 'idle')
                ) {
                    this.sawActive = false;
                    this.sync.shutdown();
                }
            });
        });
        // A freeze moved one picture: the smoothed clocks are stale.
        let epoch = 0;
        effect(() => {
            const next = this.status()?.sync?.epoch ?? 0;
            if (next === epoch) return;
            epoch = next;
            untracked(() => this.sync.dropReadings());
        });
        // A new notice replaces a dismissed one.
        effect(() => {
            if (this.state().splitAudioNotice) return;
            untracked(() => this.noticeDismissed.set(false));
        });
    }

    dismissNotice(): void {
        this.noticeDismissed.set(true);
    }

    setMode(mode: SplitSyncMode): void {
        if (this.mode() === mode) return;
        this.mode.set(mode);
        this.commands()?.setSplitAudioSyncMode?.(mode);
        if (mode === 'manual') {
            // No clock reading may steer in manual: stop reading them.
            this.sync.shutdown();
            if (this.started()) this.pushManual();
        } else if (this.started()) {
            // A mode change is not a Sync press: nothing runs until it is.
            this.started.set(false);
        }
    }

    /** "Start sync": reads the clocks (auto) or applies the typed offset (manual). */
    start(): void {
        if (!this.active()) return;
        this.started.set(true);
        this.noticeDismissed.set(false);
        this.commands()?.setSplitAudioSyncMode?.(this.mode());
        if (this.mode() === 'auto') this.runAuto();
        else this.pushManual();
    }

    /** Auto: one run - the backend measures, freezes at most once, fine-tunes, stops. */
    private runAuto(): void {
        if (!this.sync.startAuto()) return;
        this.sawActive = false;
        this.commands()?.splitAudioSyncAction?.('start');
        // The backend refused (paused, no pair): do not keep reading for nothing.
        if (this.startCheck !== null) clearTimeout(this.startCheck);
        this.startCheck = setTimeout(() => {
            this.startCheck = null;
            if (!this.sawActive && !this.running()) this.sync.shutdown();
        }, START_CHECK_MS);
    }

    /** The main button: stop what runs, or (re)start. */
    press(): void {
        if (this.stopShown()) this.stop();
        else if (this.started()) this.runAgain();
        else this.start();
    }

    /** "Sync" pressed again after a run ended. */
    runAgain(): void {
        if (this.mode() === 'auto' && this.started() && this.active()) {
            this.noticeDismissed.set(false);
            this.runAuto();
        }
    }

    stop(): void {
        if (this.mode() === 'auto')
            this.commands()?.splitAudioSyncAction?.('cancel');
        this.started.set(false);
        this.sync.shutdown();
    }

    /** The button "quick sync": the side that is ahead jumps back (never automatic). */
    quickSync(): void {
        this.commands()?.splitAudioSyncAction?.('quick');
    }

    /** Optional: the picture's own audio plays while the sound is frozen. */
    setOriginalAudio(on: boolean): void {
        this.commands()?.splitAudioSyncAction?.(
            on ? 'original-audio-on' : 'original-audio-off'
        );
    }

    /** The window where the clock regions are picked and checked. */
    openRegionPicker(): void {
        if (this.mode() === 'auto') this.sync.open();
    }

    /** Typed value; the side that is ahead stays as chosen. */
    setManualSeconds(value: number): void {
        if (!Number.isFinite(value)) return;
        this.manualSeconds.set(clampSeconds(Math.abs(value)));
        this.pushManual();
    }

    setManualLead(lead: SplitSyncLead): void {
        this.manualLead.set(lead);
        this.pushManual();
    }

    /** Fine adjust: moves the signed offset, flipping the side across zero. */
    nudgeManual(deltaSeconds: number): void {
        const signed = round(this.manualLateness() + deltaSeconds);
        this.manualLead.set(signed >= 0 ? 'picture' : 'audio');
        this.manualSeconds.set(clampSeconds(Math.abs(signed)));
        this.pushManual();
    }

    /** Sends the typed offset again (a pause, a seek or a fault voided it). */
    applyManual(): void {
        this.pushManual();
    }

    private pushManual(): void {
        if (this.mode() !== 'manual' || !this.started() || !this.active()) {
            return;
        }
        this.commands()?.reportSplitAudioLateness?.(
            this.manualLateness(),
            true
        );
    }

    private reset(): void {
        this.started.set(false);
        this.sync.shutdown();
    }
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function clampSeconds(value: number): number {
    return Math.min(MAX_MANUAL_SECONDS, round(value));
}
