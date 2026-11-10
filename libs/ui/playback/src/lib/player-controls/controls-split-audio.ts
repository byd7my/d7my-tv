import {
    computed,
    DestroyRef,
    effect,
    inject,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import {
    SPLIT_AUDIO_DIALOG_OPENER,
    SPLIT_AUDIO_OVERRIDE_BUILDER,
    SplitAudioService,
} from '@iptvnator/services';
import type {
    Channel,
    ExternalAudioOverride,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { AudioSyncController } from '../audio-sync/audio-sync.controller';
import { MatchClockOcrService } from '../match-clock/match-clock-ocr.service';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
} from './player-controls.model';

/**
 * "Audio from another channel" button of the control bar. Offered for live
 * playback once a channel list has published the channels to choose from and
 * the app can open the picker. Create it in an injection context (a component
 * field).
 *
 * Players that can mix a second stream into the running session (the embedded
 * MPV player) get a light panel over the video: opening it never touches the
 * picture. Every other player keeps the dialog, which starts an external MPV
 * window.
 */
export class ControlsSplitAudio {
    private readonly openDialog = inject(SPLIT_AUDIO_DIALOG_OPENER, {
        optional: true,
    });
    private readonly buildOverride = inject(SPLIT_AUDIO_OVERRIDE_BUILDER, {
        optional: true,
    });
    private readonly splitAudio = inject(SplitAudioService);
    private readonly ocr = inject(MatchClockOcrService);

    constructor(
        private readonly state: Signal<PlayerControlsState>,
        private readonly commands?: () => PlayerControlsCommands,
        private readonly onPanelOpened?: () => void
    ) {
        // The silent preview session must never outlive the player.
        inject(DestroyRef).onDestroy(() => this.sync.close());
        // The audio channel failed to open: it is not playing, so it must not
        // stay marked as the selected one. The picture keeps playing.
        effect(() => {
            if (this.error() && untracked(this.activeAudio)) {
                this.splitAudio.setActiveAudio(null);
                this.savedDelay.set(null);
            }
        });
    }

    /** Why the chosen audio channel does not play; null while it works. */
    readonly error = computed(() => this.state().externalAudioError ?? null);
    readonly panelOpen = signal(false);
    readonly activeAudio = this.splitAudio.activeAudio;

    /** Seconds the saved delay was last written for; drives the "saved" hint. */
    readonly savedDelay = signal<number | null>(null);

    /**
     * The embedded player always offers the button for live playback (or as
     * soon as a channel list exists), so it never vanishes while the player
     * is still working out what it plays. Other players need the channel list.
     */
    readonly available = computed(() => {
        const hasContext = this.splitAudio.context() !== null;
        if (this.usesPanel()) return this.state().isLive || hasContext;
        return this.openDialog !== null && hasContext && this.state().isLive;
    });

    /** False when the page that started the channel published no list. */
    readonly hasChannelList = computed(
        () => this.splitAudio.context() !== null
    );

    /** The channels audio can come from. Built only while the panel is open. */
    readonly channels = computed<readonly Channel[]>(() =>
        this.panelOpen() ? (this.splitAudio.context()?.channels() ?? []) : []
    );

    readonly videoUrl = computed(
        () => this.splitAudio.context()?.video.url ?? ''
    );

    /**
     * The "sync by match clock" window: reads the scoreboard clock of the
     * picture and of the audio channel and suggests the delay.
     */
    readonly sync = new AudioSyncController({
        api: () => (typeof window === 'undefined' ? undefined : window.electron),
        audio: this.activeAudio,
        videoUrl: this.videoUrl,
        setDelay: (seconds) => this.setDelay(seconds),
        suspendAudio: () => this.commands?.().setExternalAudio?.(null, 0),
        resumeAudio: () => this.replayAudio(),
        clampDelay: (seconds) => this.splitAudio.clampDelay(seconds),
        toPlayback: (audio) => this.toPlayback(audio),
        ocr: this.ocr,
    });

    /** Needs the frame-copy engine and a chosen audio channel. */
    syncAvailable(): boolean {
        return (
            this.usesPanel() &&
            this.activeAudio() !== null &&
            this.sync.available()
        );
    }

    usesPanel(): boolean {
        return (
            this.buildOverride !== null &&
            typeof this.commands?.().setExternalAudio === 'function'
        );
    }

    open(): void {
        if (this.usesPanel()) {
            this.panelOpen.update((open) => !open);
            if (this.panelOpen()) this.onPanelOpened?.();
            return;
        }
        const context = this.splitAudio.context();
        if (!context || !this.openDialog) {
            return;
        }
        // The dialog lives in the page overlay, which is hidden behind a
        // fullscreen element.
        if (document.fullscreenElement) {
            void document.exitFullscreen?.().catch(() => undefined);
        }
        this.openDialog(context);
    }

    closePanel(): void {
        this.panelOpen.set(false);
    }

    isFavorite(channel: Channel): boolean {
        return this.splitAudio.isFavorite(channel.url, 'audio');
    }

    toggleFavorite(channel: Channel): void {
        this.splitAudio.toggleFavorite(channel.url, 'audio');
    }

    /** Switches the audio to this channel; the picture keeps playing. */
    select(channel: Channel): void {
        const setExternalAudio = this.commands?.().setExternalAudio;
        const context = this.splitAudio.context();
        if (!setExternalAudio || !this.buildOverride || !context) {
            return;
        }
        const delay = this.splitAudio.savedDelay(
            context.video.url,
            channel.url
        );
        const audio = this.buildOverride(channel, delay);
        this.splitAudio.setActiveAudio(audio);
        this.savedDelay.set(delay);
        setExternalAudio(this.toPlayback(audio), delay);
        // Show the match clocks and what differs, without another click.
        if (this.syncAvailable()) this.sync.open();
    }

    /** Moves the delay by a step; applied to the running audio at once. */
    adjustDelay(deltaSeconds: number): void {
        const audio = this.activeAudio();
        if (!audio) return;
        this.setDelay((audio.delaySeconds ?? 0) + deltaSeconds);
    }

    /** Sets the delay to an exact value; applied to the running audio at once. */
    setDelay(seconds: number): void {
        const audio = this.activeAudio();
        const setDelay = this.commands?.().setExternalAudioDelay;
        if (!audio || !setDelay) return;
        const delay = this.roundDelay(this.splitAudio.clampDelay(seconds));
        this.splitAudio.setActiveAudio({ ...audio, delaySeconds: delay });
        setDelay(delay);
    }

    toggleSync(): void {
        this.sync.toggle();
    }

    /** Remembers the current delay for this video + audio pair. */
    saveDelay(): void {
        const audio = this.activeAudio();
        const context = this.splitAudio.context();
        if (!audio || !context) return;
        const delay = audio.delaySeconds ?? 0;
        this.splitAudio.saveDelay(context.video.url, audio.streamUrl, delay);
        this.savedDelay.set(delay);
    }

    isDelaySaved(): boolean {
        const audio = this.activeAudio();
        return (
            audio !== null &&
            this.savedDelay() !== null &&
            this.savedDelay() === (audio.delaySeconds ?? 0)
        );
    }

    /** Back to the channel's own audio. */
    clear(): void {
        const setExternalAudio = this.commands?.().setExternalAudio;
        if (!setExternalAudio) return;
        this.splitAudio.setActiveAudio(null);
        this.savedDelay.set(null);
        setExternalAudio(null, 0);
    }

    /** Plays the chosen audio channel again after a measure; keeps its delay. */
    private replayAudio(): void {
        const audio = this.activeAudio();
        const setExternalAudio = this.commands?.().setExternalAudio;
        if (!audio || !setExternalAudio) return;
        setExternalAudio(this.toPlayback(audio), audio.delaySeconds ?? 0);
    }

    private roundDelay(value: number): number {
        return Math.round(value * 100) / 100;
    }

    private toPlayback(audio: ExternalAudioOverride): ResolvedPortalPlayback {
        return {
            streamUrl: audio.streamUrl,
            title: audio.title ?? '',
            isLive: true,
            userAgent: audio.userAgent,
            referer: audio.referer,
            origin: audio.origin,
        };
    }
}
