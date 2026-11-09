import { effect } from '@angular/core';

/**
 * Hides the mouse cursor over the player surface while `hidden()` is true and
 * puts the previous cursor back afterwards, on every way out (controls shown,
 * surface replaced, component destroyed). Create it in an injection context.
 */
export function bindCursorHiding(
    surface: () => HTMLElement | null,
    hidden: () => boolean
): void {
    effect((onCleanup) => {
        const element = surface();
        if (!element || !hidden()) {
            return;
        }
        const previousCursor = element.style.cursor;
        element.style.cursor = 'none';
        onCleanup(() => {
            if (element.style.cursor === 'none') {
                element.style.cursor = previousCursor;
            }
        });
    });
}
