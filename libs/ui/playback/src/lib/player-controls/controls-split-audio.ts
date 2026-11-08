import { computed, inject, type Signal } from '@angular/core';
import {
    SPLIT_AUDIO_DIALOG_OPENER,
    SplitAudioService,
} from '@iptvnator/services';
import type {
    ExternalAudioOverride,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
} from './player-controls.model';

/**
 * "Audio from another channel" button of the control bar. Offered for live
 * playback once a channel list has published the channels to choose from and
 * the app can open the dialog. Create it in an injection context (a component
 * field).
 */
export class ControlsSplitAudio {
    private readonly openDialog = inject(SPLIT_AUDIO_DIALOG_OPENER, {
        optional: true,
    });
    private readonly splitAudio = inject(SplitAudioService);

    constructor(
        private readonly state: Signal<PlayerControlsState>,
        private readonly commands?: () => PlayerControlsCommands
    ) {}

    readonly available = computed(
        () =>
            this.openDialog !== null &&
            this.splitAudio.context() !== null &&
            this.state().isLive
    );

    open(): void {
        const context = this.splitAudio.context();
        if (!context || !this.openDialog) {
            return;
        }
        // The dialog lives in the page overlay, which is hidden behind a
        // fullscreen element.
        if (document.fullscreenElement) {
            void document.exitFullscreen?.().catch(() => undefined);
        }
        const setExternalAudio = this.commands?.().setExternalAudio;
        if (!setExternalAudio) {
            this.openDialog(context);
            return;
        }
        this.openDialog(context, (audio) => {
            this.splitAudio.setActiveAudio(audio);
            setExternalAudio(
                audio ? this.toPlayback(audio) : null,
                audio?.delaySeconds ?? 0
            );
        });
    }

    readonly activeAudio = this.splitAudio.activeAudio;

    adjustDelay(deltaSeconds: number): void {
        const audio = this.activeAudio();
        const setDelay = this.commands?.().setExternalAudioDelay;
        if (!audio || !setDelay) return;
        const updated = {
            ...audio,
            delaySeconds: this.splitAudio.clampDelay(
                (audio.delaySeconds ?? 0) + deltaSeconds
            ),
        };
        this.splitAudio.setActiveAudio(updated);
        const context = this.splitAudio.context();
        if (context)
            this.splitAudio.saveDelay(
                context.video.url,
                updated.streamUrl,
                updated.delaySeconds ?? 0
            );
        setDelay(updated.delaySeconds ?? 0);
    }

    clear(): void {
        const setExternalAudio = this.commands?.().setExternalAudio;
        if (!setExternalAudio) return;
        this.splitAudio.setActiveAudio(null);
        setExternalAudio(null, 0);
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
