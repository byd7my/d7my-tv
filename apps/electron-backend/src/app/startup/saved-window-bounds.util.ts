export interface WindowRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A window needs at least this many pixels on a display to be reachable. */
const MIN_VISIBLE_PX = 120;

/**
 * The saved window position, only when the window would still be reachable:
 * at least {@link MIN_VISIBLE_PX} of it must lie on a connected display.
 * A position saved on a display that is gone (external monitor unplugged,
 * remote desktop, resolution change) would open the window off-screen and the
 * app would look like it did not start; the caller then centers a default
 * window instead.
 */
export function usableSavedBounds(
    saved: Partial<WindowRect> | null | undefined,
    workAreas: readonly WindowRect[]
): WindowRect | undefined {
    if (
        !saved ||
        ![saved.x, saved.y, saved.width, saved.height].every(
            (value) => typeof value === 'number' && Number.isFinite(value)
        )
    ) {
        return undefined;
    }
    const bounds = saved as WindowRect;
    const reachable = workAreas.some((area) => {
        const overlapWidth =
            Math.min(bounds.x + bounds.width, area.x + area.width) -
            Math.max(bounds.x, area.x);
        const overlapHeight =
            Math.min(bounds.y + bounds.height, area.y + area.height) -
            Math.max(bounds.y, area.y);
        return overlapWidth >= MIN_VISIBLE_PX && overlapHeight >= MIN_VISIBLE_PX;
    });
    return reachable ? bounds : undefined;
}
