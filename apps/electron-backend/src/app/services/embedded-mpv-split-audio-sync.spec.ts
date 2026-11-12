import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import {
    RESUME_GRACE_MS,
    SplitAudioPair,
    type SoundSnapshot,
    type SplitAudioHost,
} from './embedded-mpv-split-audio';

interface Sess {
    pos: number;
    paused: boolean;
    speed: number;
    buffered: number;
    status: string;
}

/**
 * Two simulated sessions that behave like mpv does: a paused session stands
 * still and keeps reading into its cache (1 s per second), a playing one
 * advances `speed` content seconds per second. The user's pause and the
 * sync freeze are the same flag, as they are in mpv.
 */
class World implements SplitAudioHost {
    clock = 1_000_000;
    s: Record<string, Sess> = {
        main: sess(500),
        'sound-1': sess(500),
    };
    log: string[] = [];
    created = 0;
    options: string[] = [];
    jumps: Array<[string, number]> = [];
    seeks: Array<[string, number]> = [];

    now() {
        return this.clock;
    }
    createSoundSession() {
        this.created++;
        return 'sound-1';
    }
    load() {
        this.log.push('load');
    }
    setPaused(id: string, paused: boolean) {
        this.log.push(`pause:${id}:${paused}`);
        this.s[id].paused = paused;
    }
    hold(id: string, on: boolean) {
        this.log.push(`hold:${id}:${on}`);
        this.s[id].paused = on;
    }
    seekBy(id: string, delta: number) {
        this.seeks.push([id, delta]);
        this.s[id].pos += delta;
    }
    jump(id: string, delta: number) {
        this.jumps.push([id, delta]);
        this.s[id].pos += delta;
    }
    setSpeed(id: string, speed: number) {
        this.s[id].speed = speed;
    }
    setVolume(id: string, volume: number) {
        this.log.push(`volume:${id}:${volume}`);
    }
    disposeSession() {
        this.log.push('dispose');
    }
    cacheOptions() {
        return this.options;
    }
    snapshot(id: string): SoundSnapshot | null {
        const x = this.s[id];
        return {
            status: x.paused ? 'paused' : 'playing',
            positionSeconds: x.pos,
            bufferedAheadSeconds: x.buffered,
            droppedFrames: 0,
            bitrateBps: 8_000_000,
        };
    }
    advance(ms: number) {
        this.clock += ms;
        for (const x of Object.values(this.s)) {
            if (x.paused) x.buffered += ms / 1000;
            else x.pos += (ms / 1000) * x.speed;
        }
    }
    /** What the match clocks would show: picture minus sound content time. */
    get lateness() {
        return this.s['main'].pos - this.s['sound-1'].pos;
    }
}

function sess(pos: number): Sess {
    return { pos, paused: false, speed: 1, buffered: 3, status: 'playing' };
}

const PLAYBACK = {
    streamUrl: 'http://example.test/b.ts',
} as ResolvedPortalPlayback;

function make(
    over: Partial<ConstructorParameters<typeof SplitAudioPair>[1]> = {},
    gap = 0
) {
    const world = new World();
    // gap > 0: the picture is ahead of the sound
    world.s['main'].pos += gap;
    const gaveUp: string[] = [];
    const pair = new SplitAudioPair(
        world,
        {
            mainId: 'main',
            userSpeed: 1,
            userVolume: 80,
            paused: false,
            dBaseSeconds: 0.08,
            trimSeconds: 0,
            ...over,
        },
        { giveUp: (i) => gaveUp.push(i) }
    );
    pair.start(PLAYBACK);
    world.log = [];
    return { world, pair, gaveUp };
}

/** `seconds` of play with a clock reading (whole seconds, like the OCR) every second. */
function play(
    world: World,
    pair: SplitAudioPair,
    seconds: number,
    until?: () => boolean
) {
    for (let i = 0; i < seconds * 2; i++) {
        world.advance(500);
        if (i % 2 === 0) pair.reportLateness(Math.round(world.lateness));
        pair.tick();
        if (until?.()) return;
    }
}

/** Runs until the pair's state is `state` (or `seconds` pass). */
function playUntil(
    world: World,
    pair: SplitAudioPair,
    state: string,
    seconds = 400
) {
    play(world, pair, seconds, () => pair.status().state === state);
    expect(pair.status().state).toBe(state);
}

const holds = (w: World) => w.log.filter((l) => l.startsWith('hold:'));

describe('SplitAudioPair - one automatic sync', () => {
    it('does nothing by itself: without a press nothing is measured, frozen or slowed', () => {
        const { world, pair } = make({}, 12);
        play(world, pair, 120);
        expect(pair.status().state).toBe('idle');
        expect(holds(world)).toEqual([]);
        expect(world.s['main'].speed).toBe(1);
        expect(world.s['sound-1'].speed).toBe(1);
        expect(world.lateness).toBeCloseTo(12, 0);
    });

    it('refuses to start while paused or in manual mode', () => {
        const a = make({ paused: true });
        expect(a.pair.startAutoSync()).toBe(false);
        const b = make({ syncMode: 'manual' });
        expect(b.pair.startAutoSync()).toBe(false);
    });

    it('sound ahead by 10 s: freezes ONLY the sound, then the content really matches', () => {
        const { world, pair } = make({}, -10);
        expect(pair.startAutoSync()).toBe(true);
        playUntil(world, pair, 'synced');
        // one freeze of the sound, never the picture
        expect(holds(world)).toEqual([
            'hold:sound-1:true',
            'hold:sound-1:false',
        ]);
        // the picture was never touched; the content now lines up
        expect(Math.abs(world.lateness - 0.08)).toBeLessThanOrEqual(0.6);
        // both sessions are back at the user's speed
        expect(world.s['main'].speed).toBe(1);
        expect(world.s['sound-1'].speed).toBe(1);
        expect(world.created).toBe(1);
        expect(pair.status().sync?.residualSeconds).not.toBeNull();
    });

    it('picture ahead by 20 s: announces, freezes ONLY the picture, then matches', () => {
        const { world, pair } = make({}, 20);
        pair.startAutoSync();
        playUntil(world, pair, 'announcing');
        expect(pair.status().sync?.side).toBe('picture');
        expect(holds(world)).toEqual([]);
        playUntil(world, pair, 'freezing');
        expect(pair.pictureFrozen).toBe(true);
        expect(pair.ownsTransition('picture')).toBe(true);
        expect(pair.ownsTransition('sound')).toBe(false);
        playUntil(world, pair, 'synced');
        expect(holds(world)).toEqual(['hold:main:true', 'hold:main:false']);
        expect(Math.abs(world.lateness - 0.08)).toBeLessThanOrEqual(0.6);
        expect(world.s['main'].speed).toBe(1);
        expect(world.s['sound-1'].speed).toBe(1);
    });

    it('a small gap (1.4 s) is only fine-tuned: no freeze at all', () => {
        const { world, pair } = make({}, 1.4);
        pair.startAutoSync();
        playUntil(world, pair, 'synced');
        expect(holds(world)).toEqual([]);
        expect(Math.abs(world.lateness - 0.08)).toBeLessThanOrEqual(0.6);
    });

    it('at 1.5x the user speed comes back at the end, and stays what the user chose', () => {
        const { world, pair } = make({ userSpeed: 1.5 }, -8);
        world.s['main'].speed = 1.5;
        world.s['sound-1'].speed = 1.5;
        pair.startAutoSync();
        playUntil(world, pair, 'synced');
        expect(world.s['main'].speed).toBe(1.5);
        expect(world.s['sound-1'].speed).toBe(1.5);
        expect(pair.status().userSpeed).toBe(1.5);
    });

    it('once synced it never steps in again, even when a new drift shows up', () => {
        const { world, pair } = make({}, -6);
        pair.startAutoSync();
        playUntil(world, pair, 'synced');
        world.log = [];
        world.s['sound-1'].pos += 15; // the sound runs 15 s ahead later
        play(world, pair, 900);
        expect(pair.status().state).toBe('synced');
        expect(holds(world)).toEqual([]);
        expect(world.s['main'].speed).toBe(1);
        expect(world.s['sound-1'].speed).toBe(1);
        expect(world.lateness).toBeLessThan(-10);
    });

    it('a second press runs again, and only then', () => {
        const { world, pair } = make({}, -6);
        pair.startAutoSync();
        playUntil(world, pair, 'synced');
        world.s['sound-1'].pos += 10;
        pair.startAutoSync();
        playUntil(world, pair, 'synced');
        expect(holds(world).filter((l) => l.endsWith(':true'))).toHaveLength(2);
        expect(Math.abs(world.lateness - 0.08)).toBeLessThanOrEqual(0.6);
    });

    describe('the user takes over', () => {
        it('a pause during the picture freeze ends the run and the pause stays the user', () => {
            const { world, pair } = make({}, 20);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            world.log = [];
            pair.onPause(true);
            world.setPaused('main', true); // what the service does for the user
            expect(pair.status().state).toBe('paused');
            expect(pair.status().sync?.failure).toBe('interrupted');
            // the release never resumed what the user paused
            expect(world.log).not.toContain('hold:main:false');
            expect(world.s['main'].paused).toBe(true);
            expect(pair.pictureFrozen).toBe(false);
        });

        it('a seek during the freeze resumes the picture and the pair is not left hanging', () => {
            const { world, pair } = make({}, 20);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            pair.onSeekBy(-10);
            expect(world.log).toContain('hold:main:false');
            expect(world.s['main'].paused).toBe(false);
            expect(pair.status().sync?.failure).toBe('interrupted');
            // the sound followed the seek
            expect(world.seeks).toEqual([['sound-1', -10]]);
        });

        it('a reload during the freeze ends the run and releases the freeze', () => {
            const { world, pair } = make({}, -9);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            pair.onSoundReloaded();
            expect(world.s['sound-1'].paused).toBe(false);
            expect(pair.status().state).toBe('failed');
        });

        it('stopping the pair mid-freeze gives the picture back unfrozen', () => {
            const { world, pair } = make({}, 20);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            pair.stop();
            expect(world.s['main'].paused).toBe(false);
            expect(world.s['main'].speed).toBe(1);
        });

        it('the end of a freeze is not taken for a reload for a few seconds', () => {
            const { world, pair } = make({}, -9);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            expect(pair.ownsTransition('sound')).toBe(true);
            play(world, pair, 14, () => !pair.ownsTransition('sound'));
            world.advance(RESUME_GRACE_MS + 100);
            expect(pair.ownsTransition('sound')).toBe(false);
        });
    });

    describe('the picture channel audio while the sound is frozen (optional)', () => {
        it('is off by default: the picture stays muted', () => {
            const { world, pair } = make({}, -9);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            expect(
                world.log.filter((l) => l.startsWith('volume:main'))
            ).toEqual([]);
        });

        it('when on, never plays both: sound quiet first, picture muted before the sound resumes', () => {
            const { world, pair } = make({}, -9);
            pair.setOriginalAudioDuringFreeze(true);
            world.log = [];
            pair.startAutoSync();
            playUntil(world, pair, 'synced');
            const l = world.log;
            const hold = l.indexOf('hold:sound-1:true');
            const up = l.indexOf('volume:main:80');
            const down = l.indexOf('volume:main:0');
            const resume = l.indexOf('hold:sound-1:false');
            expect(hold).toBeGreaterThanOrEqual(0);
            expect(up).toBeGreaterThan(hold);
            expect(down).toBeGreaterThan(up);
            expect(resume).toBeGreaterThan(down);
        });

        it('a cancel mid-freeze mutes the picture again', () => {
            const { world, pair } = make({}, -9);
            pair.setOriginalAudioDuringFreeze(true);
            pair.startAutoSync();
            playUntil(world, pair, 'freezing');
            pair.cancelAutoSync();
            const l = world.log;
            expect(l.lastIndexOf('volume:main:0')).toBeGreaterThan(
                l.lastIndexOf('volume:main:80')
            );
            expect(world.s['sound-1'].paused).toBe(false);
        });
    });

    describe('quick sync (only on the button)', () => {
        it('jumps the picture back when it is ahead, never the sound, and never via a user seek', () => {
            const { world, pair } = make({}, 6);
            world.advance(30_000); // some history to jump into
            pair.reportLateness(6);
            const r = pair.quickSync();
            expect(r).toEqual({
                kind: 'jumped',
                side: 'picture',
                seconds: 5.9,
            });
            expect(world.jumps).toEqual([['main', -5.9]]);
            expect(world.seeks).toEqual([]);
        });

        it('jumps the sound back when it is ahead', () => {
            const { world, pair } = make({}, -6);
            world.advance(30_000);
            pair.reportLateness(-6);
            expect(pair.quickSync()).toMatchObject({
                kind: 'jumped',
                side: 'sound',
            });
            expect(world.jumps[0][0]).toBe('sound-1');
        });

        it('says why it cannot: no reading, too far, no history, cache too small', () => {
            const a = make({}, 6);
            expect(a.pair.quickSync()).toEqual({
                kind: 'unavailable',
                why: 'no-reading',
            });
            const b = make({}, 40);
            b.world.advance(120_000);
            b.pair.reportLateness(40);
            expect(b.pair.quickSync()).toEqual({
                kind: 'unavailable',
                why: 'too-far',
            });
            const c = make({}, 6);
            c.pair.reportLateness(6);
            expect(c.pair.quickSync()).toEqual({
                kind: 'unavailable',
                why: 'no-history',
            });
            const d = make({}, 6);
            d.world.options = ['demuxer-max-back-bytes=2MiB'];
            d.world.advance(60_000);
            d.pair.reportLateness(6);
            expect(d.pair.quickSync()).toEqual({
                kind: 'unavailable',
                why: 'cache',
            });
            expect(d.world.jumps).toEqual([]);
        });

        it('is never started by the run itself', () => {
            const { world, pair } = make({}, -9);
            pair.startAutoSync();
            playUntil(world, pair, 'synced');
            expect(world.jumps).toEqual([]);
        });
    });

    describe('manual mode', () => {
        it('a correction cancelled by a pause is not applied again, and says so', () => {
            const { world, pair } = make({ syncMode: 'manual' }, 4);
            world.advance(6000);
            pair.reportManualLateness(4);
            play(world, pair, 5);
            expect(pair.status().correcting).toBe('main');
            pair.onPause(true);
            pair.onPause(false);
            expect(pair.status().manualVoided).toBe('pause');
            play(world, pair, 20);
            expect(pair.status().correcting).toBeNull();
            expect(world.s['main'].speed).toBe(1);
            // typing a value is the user's decision: it clears the notice
            pair.reportManualLateness(4);
            expect(pair.status().manualVoided).toBeNull();
        });

        it('a typed value closes its gap all the way (no early expiry)', () => {
            const { world, pair } = make({ syncMode: 'manual' }, 5);
            world.advance(6000);
            pair.reportManualLateness(world.lateness);
            for (let i = 0; i < 1600; i++) {
                world.advance(500);
                pair.tick();
            }
            expect(Math.abs(world.lateness - 0.08)).toBeLessThan(0.25);
        });
    });
});
