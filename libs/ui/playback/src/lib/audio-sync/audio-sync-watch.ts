import { effect, untracked, type Signal } from '@angular/core';

/**
 * Calls `onChange` with the audio channel's stream URL each time the channel
 * changes (not for the first value): a different channel needs its own
 * picture and region. Create it in an injection context.
 */
export function watchAudioChannel(
    audio: Signal<{ streamUrl: string } | null>,
    onChange: (url: string | null) => void
): void {
    let lastUrl: string | null = null;
    effect(() => {
        const url = audio()?.streamUrl ?? null;
        untracked(() => {
            if (url === lastUrl) return;
            lastUrl = url;
            onChange(url);
        });
    });
}
