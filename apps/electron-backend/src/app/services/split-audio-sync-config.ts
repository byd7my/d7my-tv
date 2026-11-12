/** Tuning of the automatic sync run (see split-audio-sync-run.ts). */
export const SYNC_CONFIG = {
    /** Up to here only the fine correction acts. */
    smallGapSeconds: 2,
    /** Inside this the run is done (the clock reading is whole seconds). */
    toleranceSeconds: 0.5,
    windowMs: 10000,
    minReadings: 6,
    /** A reading farther than this from the median is an outlier. */
    inlierBand: 1,
    maxOutlierShare: 0.2,
    /** Largest spread of the inliers for a window to count as stable. */
    maxSpread: 1.5,
    /** The stable window must hold this long before anything is decided. */
    confirmMs: 4000,
    measureTimeoutMs: 45000,
    pictureAnnounceMs: 3000,
    pictureMaxSeconds: 30,
    soundMaxSeconds: 60,
    /** The freeze stops short of the gap by this much; the fine part finishes. */
    marginSeconds: 0.3,
    /** The cache has to hold the freeze plus its own buffer, with this headroom. */
    cacheHeadroom: 1.25,
    cacheExtraSeconds: 5,
    /** After this long frozen the cache must have grown by `growthShare` of it. */
    growthCheckAfterMs: 3000,
    growthShare: 0.4,
    cacheFullShare: 0.9,
    resumeRetryMs: 2500,
    resumeFailMs: 6000,
    /** The sound is not trusted while the readings still show the old gap. */
    settleAfterFreezeMs: 10000,
    fineTimeoutMs: 240000,
    successHoldMs: 6000,
} as const;
