import {
    SyncCorrector,
    DEFAULT_CORRECTOR_CONFIG,
} from './split-audio-corrector';

/**
 * A tiny plant: lateness (picture clock - sound clock) moves by
 * `main factor - sound factor` content seconds per second, which is what two
 * players really do (measured on two mpv processes: 3 % slower = 0.0291 s/s).
 */
function simulate(opts: {
    start: number;
    target: number;
    seconds: number;
    noise?: (t: number) => number;
    corrector?: SyncCorrector;
    from?: number;
}): {
    corrector: SyncCorrector;
    lateness: number;
    maxMain: number;
    maxSound: number;
    minFactor: number;
    log: number[];
} {
    const corrector = opts.corrector ?? new SyncCorrector();
    corrector.setTarget(opts.target);
    let lateness = opts.start;
    let maxMain = 0;
    let maxSound = 0;
    let minFactor = 1;
    const log: number[] = [];
    for (let t = opts.from ?? 0; t < (opts.from ?? 0) + opts.seconds; t++) {
        const now = t * 1000;
        const f = corrector.factors;
        lateness += f.main - f.sound;
        // The sound is late when the picture runs ahead of it: slowing the sound
        // (factor < 1) makes it later, slowing the picture earlier.
        corrector.addReading(lateness + (opts.noise?.(t) ?? 0), now);
        corrector.step(now);
        maxMain = Math.max(maxMain, 1 - corrector.factors.main);
        maxSound = Math.max(maxSound, 1 - corrector.factors.sound);
        minFactor = Math.min(
            minFactor,
            corrector.factors.main,
            corrector.factors.sound
        );
        log.push(lateness);
    }
    return { corrector, lateness, maxMain, maxSound, minFactor, log };
}

describe('SyncCorrector', () => {
    it('slows the muted picture when the sound is late and lets go on target', () => {
        const r = simulate({ start: 3, target: 0, seconds: 200 });
        expect(Math.abs(r.lateness)).toBeLessThan(0.1);
        expect(r.maxMain).toBeGreaterThan(0.01);
        expect(r.maxMain).toBeLessThanOrEqual(
            DEFAULT_CORRECTOR_CONFIG.maxMainRate + 1e-9
        );
        expect(r.maxSound).toBe(0);
        expect(r.corrector.factors).toEqual({ main: 1, sound: 1 });
        expect(r.corrector.state.locked).toBe(false);
    });

    it('slows the sound when it is early, never more than its cap', () => {
        const r = simulate({ start: -2, target: 0, seconds: 200 });
        expect(Math.abs(r.lateness)).toBeLessThan(0.1);
        expect(r.maxSound).toBeGreaterThan(0.01);
        expect(r.maxSound).toBeLessThanOrEqual(
            DEFAULT_CORRECTOR_CONFIG.maxSoundRate + 1e-9
        );
        expect(r.maxMain).toBe(0);
    });

    it('never speeds anything up', () => {
        const r = simulate({ start: 5, target: 0, seconds: 150 });
        expect(r.minFactor).toBeLessThanOrEqual(1);
        const f = r.corrector.factors;
        expect(f.main).toBeLessThanOrEqual(1);
        expect(f.sound).toBeLessThanOrEqual(1);
    });

    it('aims at the target (D_base + trim), not at zero', () => {
        const r = simulate({ start: 0, target: 0.6, seconds: 200 });
        expect(Math.abs(r.lateness - 0.6)).toBeLessThan(0.1);
    });

    it('does not oscillate: few direction changes and no lock', () => {
        const r = simulate({
            start: 3,
            target: 0,
            seconds: 300,
            noise: (t) => (t % 7 === 0 ? 0.08 : -0.03),
        });
        expect(r.corrector.state.locked).toBe(false);
        expect(Math.abs(r.lateness)).toBeLessThan(0.2);
    });

    it('ignores a window with a wild spread', () => {
        const c = new SyncCorrector();
        c.setTarget(0);
        [0, 3, -2, 5, 0, 4].forEach((v, i) => c.addReading(v, i * 1000));
        c.step(6000);
        expect(c.state.reason).toBe('noisy');
        expect(c.factors).toEqual({ main: 1, sound: 1 });
    });

    it('waits for enough readings', () => {
        const c = new SyncCorrector();
        c.addReading(3, 0);
        c.addReading(3, 1000);
        c.step(2000);
        expect(c.state.reason).toBe('none');
        expect(c.factors).toEqual({ main: 1, sound: 1 });
    });

    it('reset drops readings, restores the factors and holds for the settle time', () => {
        const r = simulate({ start: 3, target: 0, seconds: 30 });
        expect(r.corrector.factors.main).toBeLessThan(1);
        r.corrector.reset(30000, 4000);
        expect(r.corrector.factors).toEqual({ main: 1, sound: 1 });
        r.corrector.addReading(3, 30500);
        r.corrector.addReading(3, 31500);
        r.corrector.addReading(3, 32500);
        r.corrector.addReading(3, 33000);
        r.corrector.step(33500);
        expect(r.corrector.state.reason).toBe('settling');
        expect(r.corrector.factors).toEqual({ main: 1, sound: 1 });
        r.corrector.step(34500);
        expect(r.corrector.state.reason).toBe('ok');
        expect(r.corrector.factors.main).toBeLessThan(1);
    });

    it('steers a single manual reading by dead reckoning, then lets go', () => {
        const c = new SyncCorrector();
        c.setTarget(0);
        c.setManual(2, 0);
        let lateness = 2;
        for (let t = 1; t <= 120; t++) {
            const f = c.factors;
            lateness += f.main - f.sound;
            c.step(t * 1000);
        }
        expect(Math.abs(lateness)).toBeLessThan(0.2);
        expect(c.factors).toEqual({ main: 1, sound: 1 });
    });

    /** A manual reading closed by the physical plant above. */
    function runManual(start: number, seconds: number, speed = 1) {
        const c = new SyncCorrector();
        c.setTarget(0.08);
        c.setSpeed(speed, 0);
        c.setManual(start, 0);
        let lateness = start;
        let steered = 0;
        for (let t = 1; t <= seconds; t++) {
            const f = c.factors;
            lateness += speed * (f.main - f.sound);
            c.step(t * 1000);
            if (c.state.active) steered = t;
        }
        return { c, lateness, steered };
    }

    it.each([
        ['the sound is 10 s early (slows the sound, 3 %)', -10],
        ['the sound is 10 s late (slows the picture, 6 %)', 10],
    ])(
        'closes a 10 s manual gap all the way when %s, past the old 150 s horizon',
        (_label, start) => {
            const r = runManual(start, 900);
            // It really took longer than the old horizon, and ended on target.
            expect(r.steered).toBeGreaterThan(
                DEFAULT_CORRECTOR_CONFIG.manualHorizonMs / 1000
            );
            expect(Math.abs(r.lateness - 0.08)).toBeLessThan(0.1);
            expect(r.c.factors).toEqual({ main: 1, sound: 1 });
        }
    );

    it('counts a slowdown of r as r / (1 + r) of progress, not r', () => {
        const r = runManual(10, 900);
        // With the slope taken as `r` the dead reckoning thinks the gap is
        // closed while ~0.5 s of it is still there.
        expect(Math.abs(r.lateness - 0.08)).toBeLessThan(0.1);
    });

    it('knows the user speed: at 2x the same slowdown closes the gap twice as fast', () => {
        const r = runManual(4, 400, 2);
        expect(Math.abs(r.lateness - 0.08)).toBeLessThan(0.15);
    });

    it('still drops an idle manual reading after its horizon', () => {
        const c = new SyncCorrector();
        c.setTarget(0);
        c.setManual(0.05, 0); // inside the dead band: nothing to steer
        c.step(1000);
        expect(c.factors).toEqual({ main: 1, sound: 1 });
        expect(c.state.reason).toBe('ok');
        c.step(DEFAULT_CORRECTOR_CONFIG.manualHorizonMs + 5000);
        expect(c.state.reason).toBe('none');
    });

    it('does not steer on a manual reading forever', () => {
        const c = new SyncCorrector();
        c.setTarget(0);
        c.setManual(600, 0);
        c.step(1000);
        expect(c.factors.main).toBeLessThan(1);
        c.step(DEFAULT_CORRECTOR_CONFIG.manualMaxMs + 5000);
        expect(c.factors).toEqual({ main: 1, sound: 1 });
        expect(c.state.reason).toBe('none');
    });

    it('locks after repeated direction changes and stays still until reset', () => {
        const c = new SyncCorrector({
            ...DEFAULT_CORRECTOR_CONFIG,
            minReadings: 1,
            windowMs: 1500,
            maxFlips: 2,
        });
        c.setTarget(0);
        let t = 0;
        const readAndStep = (v: number) => {
            t += 2000;
            c.addReading(v, t);
            c.step(t);
        };
        readAndStep(2); // slow main
        readAndStep(0); // inside the band: idle
        readAndStep(-2); // slow sound (flip 1)
        readAndStep(0);
        readAndStep(2); // slow main (flip 2): locked
        expect(c.state.locked).toBe(true);
        expect(c.factors).toEqual({ main: 1, sound: 1 });
        readAndStep(2);
        expect(c.factors).toEqual({ main: 1, sound: 1 });
        c.reset(t, 0);
        expect(c.state.locked).toBe(false);
    });

    it('lets the lock go once a lock window has passed, and can steer again', () => {
        const c = new SyncCorrector({
            ...DEFAULT_CORRECTOR_CONFIG,
            minReadings: 1,
            windowMs: 1500,
            maxFlips: 2,
            lockWindowMs: 20000,
        });
        c.setTarget(0);
        let t = 0;
        const readAndStep = (v: number) => {
            t += 2000;
            c.addReading(v, t);
            c.step(t);
        };
        readAndStep(2);
        readAndStep(0);
        readAndStep(-2);
        readAndStep(0);
        readAndStep(2);
        expect(c.state.locked).toBe(true);
        for (let i = 0; i < 6; i++) readAndStep(2);
        expect(c.state.locked).toBe(true);
        for (let i = 0; i < 6; i++) readAndStep(2);
        expect(c.state.locked).toBe(false);
        expect(c.state.active).toBe('main');
    });

    it('release lets go at once and holds before deciding again', () => {
        const r = simulate({ start: 3, target: 0, seconds: 30 });
        r.corrector.release(30000, 5000);
        expect(r.corrector.factors).toEqual({ main: 1, sound: 1 });
        r.corrector.step(32000);
        expect(r.corrector.state.reason).toBe('settling');
    });
});
