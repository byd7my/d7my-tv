/** How often a running app looks for a newer release again. */
export const APP_UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Calls `check` every `intervalMs` until the returned function is called. The
 * timer never keeps the process alive: a quit is not held up by it.
 */
export function startPeriodicUpdateChecks(
    check: () => void,
    intervalMs: number = APP_UPDATE_RECHECK_MS
): () => void {
    const timer = setInterval(check, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
