import {
    AutoSyncRun,
    SYNC_CONFIG,
    type FineState,
    type SideProbe,
    type SyncRunIO,
    type SyncSide,
} from './split-audio-sync-run';

const TARGET = 0.08;

class FakeIO implements SyncRunIO {
    clock = 0;
    speed = 1;
    holds: Array<[SyncSide, boolean]> = [];
    begun = 0;
    ended = 0;
    gaveUp = 0;
    fineState: FineState = {
        active: null,
        lateness: null,
        reason: 'none',
        locked: false,
    };
    probes: Record<SyncSide, SideProbe | null> = {
        picture: probe('playing', 100, 20),
        sound: probe('playing', 100, 20),
    };
    cache = { seconds: 150, bytes: 150 * 1024 * 1024 };
    /** Mimics mpv: a held side reads ahead 1 s per second and stands still. */
    autoProbes = true;
    private heldSince: Partial<Record<SyncSide, number>> = {};
    private basePos: Partial<Record<SyncSide, number>> = {};

    now() {
        return this.clock;
    }
    target() {
        return TARGET;
    }
    userSpeed() {
        return this.speed;
    }
    hold(side: SyncSide, on: boolean) {
        this.holds.push([side, on]);
        const p = this.probes[side];
        if (on) {
            this.heldSince[side] = this.clock;
            this.basePos[side] = p?.positionSeconds ?? 0;
            if (p) p.status = 'paused';
        } else {
            delete this.heldSince[side];
            if (p) p.status = 'playing';
        }
    }
    probe(side: SyncSide) {
        const p = this.probes[side];
        if (!p) return null;
        const since = this.heldSince[side];
        if (
            this.autoProbes &&
            since !== undefined &&
            p.bufferedAheadSeconds !== null
        ) {
            const held = (this.clock - since) / 1000;
            p.bufferedAheadSeconds = 20 + held;
        }
        return { ...p };
    }
    cacheAhead() {
        return this.cache;
    }
    beginFine() {
        this.begun++;
    }
    endFine() {
        this.ended++;
    }
    fine() {
        return this.fineState;
    }
    giveUp() {
        this.gaveUp++;
    }
}

function probe(
    status: string,
    positionSeconds: number,
    bufferedAheadSeconds: number | null
): SideProbe {
    return {
        status,
        positionSeconds,
        bufferedAheadSeconds,
        bitrateBps: 8_000_000,
    };
}

/** Runs `seconds` of wall time; readings (1/s) come from `read(t)`, null: none. */
function drive(
    io: FakeIO,
    run: AutoSyncRun,
    seconds: number,
    read: (t: number) => number | null,
    afterTick?: () => void
) {
    for (let i = 0; i < seconds * 2; i++) {
        io.clock += 500;
        if (i % 2 === 0) {
            const v = read(io.clock / 1000);
            if (v !== null) run.addReading(v);
        }
        run.tick();
        afterTick?.();
    }
}

/** Drives until the run reaches `phase` (or fails the test after `max` s). */
function until(
    io: FakeIO,
    run: AutoSyncRun,
    phase: string,
    read: (t: number) => number | null,
    max = 60
) {
    for (let i = 0; i < max * 2 && run.current !== phase; i++) {
        drive(io, run, 0.5, read);
    }
    expect(run.current).toBe(phase);
}

/** A steady reading of `gap` seconds over the target. */
const steady = (gap: number) => () => TARGET + gap;

function setup() {
    const io = new FakeIO();
    const run = new AutoSyncRun(io);
    return { io, run };
}

/** Everything the fine correction needs to say "inside": for tests of the end. */
function fineInside(io: FakeIO) {
    io.fineState = {
        active: null,
        lateness: TARGET + 0.05,
        reason: 'ok',
        locked: false,
    };
}

describe('AutoSyncRun', () => {
    it('does nothing until the user starts it', () => {
        const { io, run } = setup();
        run.addReading(5);
        run.tick();
        expect(run.current).toBe('idle');
        expect(io.holds).toEqual([]);
    });

    it('is done at once when the gap is already inside the margin, and touches nothing', () => {
        const { io, run } = setup();
        run.start();
        drive(io, run, 20, steady(0.2));
        expect(run.current).toBe('done');
        expect(io.holds).toEqual([]);
        expect(io.begun).toBe(0);
        expect(io.ended).toBe(1);
    });

    it('leaves a gap of up to 2 s to the fine correction, without any freeze', () => {
        const { io, run } = setup();
        run.start();
        drive(io, run, 20, steady(1.6));
        expect(run.current).toBe('fine');
        expect(io.begun).toBe(1);
        expect(io.holds).toEqual([]);
        fineInside(io);
        drive(io, run, SYNC_CONFIG.successHoldMs / 1000 + 2, () => null);
        expect(run.current).toBe('done');
        expect(run.status().failure).toBeNull();
    });

    it('freezes ONLY the sound when it is ahead, for the gap, then resumes and fine-tunes', () => {
        const { io, run } = setup();
        run.start();
        until(io, run, 'freezing', steady(-10)); // the sound is 10 s ahead
        expect(io.holds).toEqual([['sound', true]]);
        expect(run.current).toBe('freezing');
        const st = run.status();
        expect(st.side).toBe('sound');
        expect(st.freezeSeconds).toBeCloseTo(10 - SYNC_CONFIG.marginSeconds, 1);
        // the countdown goes down while frozen
        drive(io, run, 3, () => null);
        expect(run.status().remainingSeconds).toBeLessThan(st.freezeSeconds);
        drive(
            io,
            run,
            12,
            () => null,
            () => {
                if (io.probes.sound && io.probes.sound.status === 'playing') {
                    io.probes.sound.positionSeconds += 0.5;
                }
            }
        );
        expect(io.holds).toEqual([
            ['sound', true],
            ['sound', false],
        ]);
        expect(io.holds.some(([side]) => side === 'picture')).toBe(false);
        expect(['settling', 'fine']).toContain(run.current);
    });

    it('announces the picture freeze first, then freezes ONLY the picture', () => {
        const { io, run } = setup();
        run.start();
        until(io, run, 'announcing', steady(8)); // the picture is 8 s ahead
        expect(io.holds).toEqual([]);
        expect(run.status().announceSeconds).toBeGreaterThan(0);
        expect(run.status().side).toBe('picture');
        drive(io, run, SYNC_CONFIG.pictureAnnounceMs / 1000 + 1, () => null);
        expect(run.current).toBe('freezing');
        expect(io.holds).toEqual([['picture', true]]);
        expect(run.pictureFrozen).toBe(true);
    });

    it('freezes the picture at most 30 s and leaves the rest to the fine correction', () => {
        const { io, run } = setup();
        io.cache = { seconds: 600, bytes: 600 * 1024 * 1024 };
        run.start();
        until(io, run, 'announcing', steady(55));
        const st = run.status();
        expect(st.freezeSeconds).toBe(SYNC_CONFIG.pictureMaxSeconds);
        expect(st.capped).toBe(true);
    });

    it('waits the gap divided by the user speed (2x closes it twice as fast)', () => {
        const { io, run } = setup();
        io.speed = 2;
        run.start();
        until(io, run, 'freezing', steady(-10));
        expect(Math.abs(run.status().freezeSeconds - 4.85)).toBeLessThan(0.1);
    });

    it('never freezes on outliers: a clock glitch among steady readings is ignored', () => {
        const { io, run } = setup();
        run.start();
        drive(io, run, 25, (t) =>
            Math.round(t) % 9 === 0 ? 40 : TARGET + 0.1
        );
        expect(io.holds).toEqual([]);
        expect(run.current).toBe('done');
    });

    it('does not freeze on readings that keep moving; it fails as unstable', () => {
        const { io, run } = setup();
        run.start();
        drive(io, run, 50, (t) => TARGET + (Math.round(t) % 2 === 0 ? 12 : -9));
        expect(io.holds).toEqual([]);
        expect(run.current).toBe('failed');
        expect(run.status().failure).toBe('unstable');
    });

    it('fails with no-clock when nothing can be read', () => {
        const { io, run } = setup();
        run.start();
        drive(io, run, 50, () => null);
        expect(run.current).toBe('failed');
        expect(run.status().failure).toBe('no-clock');
    });

    it('does not freeze when the readings disagree on the direction', () => {
        const { io, run } = setup();
        run.start();
        // 6 s gap seen as 5.2 .. 6.6 but dipping to the other side of the target
        drive(io, run, 25, (t) =>
            Math.round(t) % 4 === 0 ? TARGET - 0.4 : TARGET + 2.2
        );
        expect(io.holds).toEqual([]);
    });

    describe('the cache', () => {
        it('skips the freeze when the real cache cannot hold it and corrects gradually', () => {
            const { io, run } = setup();
            io.cache = { seconds: 15, bytes: 15 * 1024 * 1024 };
            run.start();
            until(io, run, 'fine', steady(-10));
            expect(io.holds).toEqual([]);
            expect(run.current).toBe('fine');
            expect(run.status().freezeCut).toBe('cache-insufficient');
        });

        it('skips the freeze when the cache statistics are not available', () => {
            const { io, run } = setup();
            io.probes.sound = probe('playing', 100, null);
            run.start();
            until(io, run, 'fine', steady(-10));
            expect(io.holds).toEqual([]);
            expect(run.status().freezeCut).toBe('cache-insufficient');
        });

        it('cuts the freeze short when the cache stops growing', () => {
            const { io, run } = setup();
            io.autoProbes = false; // the buffer stays at 20 s while frozen
            run.start();
            until(io, run, 'freezing', steady(-10));
            expect(run.current).toBe('freezing');
            drive(io, run, 6, () => null);
            expect(io.holds.at(-1)).toEqual(['sound', false]);
            expect(run.status().freezeCut).toBe('cache-stalled');
            expect(run.current).toBe('resuming');
        });

        it('cuts the freeze short when the cache is nearly full', () => {
            const { io, run } = setup();
            run.start();
            until(io, run, 'freezing', steady(-10));
            // 12 s of 8 Mb/s fill 90 % of a 10.6 MB cache that was thought big enough
            io.cache = { seconds: 150, bytes: 10 * 1024 * 1024 };
            drive(io, run, 4, () => null);
            expect(run.status().freezeCut).toBe('cache-full');
            expect(io.holds.at(-1)).toEqual(['sound', false]);
        });
    });

    describe('cancelling and failing', () => {
        it('a user cancel during the freeze releases it at once and ends idle', () => {
            const { io, run } = setup();
            run.start();
            until(io, run, 'freezing', steady(-10));
            run.cancel(null);
            expect(io.holds.at(-1)).toEqual(['sound', false]);
            expect(run.current).toBe('idle');
            expect(io.ended).toBe(1);
        });

        it('an interruption (pause, seek, reload) releases the freeze and says so', () => {
            const { io, run } = setup();
            run.start();
            until(io, run, 'freezing', steady(8));
            expect(run.current).toBe('freezing');
            run.cancel('interrupted');
            expect(io.holds.at(-1)).toEqual(['picture', false]);
            expect(run.current).toBe('failed');
            expect(run.status().failure).toBe('interrupted');
            expect(run.pictureFrozen).toBe(false);
        });

        it('a side that does not resume is retried once, then the pair is given up', () => {
            const { io, run } = setup();
            run.start();
            until(io, run, 'freezing', steady(-10));
            drive(
                io,
                run,
                20,
                () => null,
                () => {
                    const p = io.probes.sound;
                    if (p && run.current === 'resuming') p.status = 'paused';
                }
            );
            const releases = io.holds.filter(([, on]) => !on).length;
            expect(releases).toBeGreaterThanOrEqual(2);
            expect(run.current).toBe('failed');
            expect(run.status().failure).toBe('resume-failed');
            expect(io.gaveUp).toBe(1);
        });

        it('treats a side that is playing again before its time as somebody else resuming it', () => {
            const { io, run } = setup();
            run.start();
            until(io, run, 'freezing', steady(-10));
            io.probes.sound = probe('playing', 100, 25);
            io.autoProbes = false;
            drive(io, run, 3, () => null);
            expect(run.current).toBe('failed');
            expect(run.status().failure).toBe('interrupted');
        });

        it('ends failed with the difference that is left, and never freezes a second time', () => {
            const { io, run } = setup();
            run.start();
            until(io, run, 'freezing', steady(-10));
            let freezes = io.holds.filter(([, on]) => on).length;
            drive(
                io,
                run,
                20,
                () => null,
                () => {
                    if (io.probes.sound?.status === 'playing') {
                        io.probes.sound.positionSeconds += 0.5;
                    }
                }
            );
            io.fineState = {
                active: 'sound',
                lateness: TARGET - 1.4,
                reason: 'ok',
                locked: false,
            };
            drive(io, run, SYNC_CONFIG.fineTimeoutMs / 1000 + 20, steady(-1.4));
            expect(run.current).toBe('failed');
            expect(run.status().failure).toBe('timeout');
            expect(run.status().residualSeconds).toBeCloseTo(-1.4, 1);
            freezes = io.holds.filter(([, on]) => on).length;
            expect(freezes).toBe(1);
        });
    });

    describe('after the run', () => {
        it('stays quiet once synced: no hold, no speed change, whatever the clocks say', () => {
            const { io, run } = setup();
            run.start();
            drive(io, run, 20, steady(0.1));
            expect(run.current).toBe('done');
            const begun = io.begun;
            const ended = io.ended;
            drive(io, run, 600, steady(25));
            expect(run.current).toBe('done');
            expect(io.holds).toEqual([]);
            expect(io.begun).toBe(begun);
            expect(io.ended).toBe(ended);
        });

        it('starts again only when asked, and may then freeze again', () => {
            const { io, run } = setup();
            run.start();
            drive(io, run, 20, steady(0.1));
            expect(run.start()).toBe(true);
            until(io, run, 'freezing', steady(-9));
            expect(io.holds).toEqual([['sound', true]]);
        });

        it('refuses a second start while one is running', () => {
            const { run } = setup();
            expect(run.start()).toBe(true);
            expect(run.start()).toBe(false);
        });
    });
});
