import { computed, inject, type Signal } from '@angular/core';
import {
    SPLIT_AUDIO_DIALOG_OPENER,
    SplitAudioService,
} from '@iptvnator/services';
import type { PlayerControlsState } from './player-controls.model';

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

    constructor(private readonly state: Signal<PlayerControlsState>) {}

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
        this.openDialog(context);
    }
}
