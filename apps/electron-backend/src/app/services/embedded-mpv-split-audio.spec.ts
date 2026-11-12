import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import {
    clampSpeed,
    SETTLE_MS,
    SplitAudioPair,
    type SoundSnapshot,
    type SplitAudioHost,
} from './embedded-mpv-split-audio';

class FakeHost implements SplitAudioHost {
    clock = 1_000_000;
    speeds = new Map<string, number>();
    volumes = new Map<string, number>();
    paused = new Map<string, boolean>();
    seeks: Array<[string, number]> = [];
    disposed: string[] = [];
    loaded: string[] = [];
    soundSnap: SoundSnapshot | null = null;
    speedCalls: Array<[string, number]> = [];

    now() {
        return this.clock;
    }
    createSoundSession() {
        return 'sound-1';
    }
    load(id: string) {
        this.loaded.push(id);
    }
    setPaused(id: string, paused: boolean) {
        this.paused.set(id, paused);
    }
    seekBy(id: string, delta: number) {
        this.seeks.push([id, delta]);
    }
    holds = new Map<string, boolean>();
    holdCalls: Array<[string, boolean]> = [];
    jumps: Array<[string, number]> = [];
    options: string[] = [];
    hold(id: string, on: boolean) {
        this.holds.set(id, on);
        this.holdCalls.push([id, on]);
    }
    jump(id: string, delta: number) {
        this.jumps.push([id, delta]);
    }
    cacheOptions() {
        return this.options;
    }
    setSpeed(id: string, speed: number) {
        this.speeds.set(id, speed);
        this.speedCalls.push([id, speed]);
    }
    setVolume(id: string, volume: number) {
        this.volumes.set(id, volume);
    }
    disposeSession(id: string) {
        this.disposed.push(id);
    }
    snapshot() {
        return this.soundSnap;
    }
    advance(ms: number) {
        this.clock += ms;
    }
}

const PLAYBACK = {
    streamUrl: 'http://example.test/b.ts',
} as ResolvedPortalPlayback;
const D_BASE = 0.08;

function make(
    overrides: Partial<ConstructorParameters<typeof SplitAudioPair>[1]> = {}
) {
    const host = new FakeHost();
    const gaveUp: string[] = [];
    const pair = new SplitAudioPair(
        host,
        {
            mainId: 'main',
            userSpeed: 1,
            userVolume: 80,
            paused: false,
            dBaseSeconds: D_BASE,
            trimSeconds: 0,
            ...overrides,
        },
        { giveUp: (issue) => gaveUp.push(issue) }
    );
    pair.start(PLAYBACK);
    return { host, pair, gaveUp };
}

/**
 * The user presses Sync, then steady readings and ticks follow: the run
 * measures, hands a small gap to the fine correction and the correction acts.
 */
function converge(
    host: FakeHost,
    pair: SplitAudioPair,
    lateness: number,
    seconds = 32
) {
    host.advance(SETTLE_MS.reload + 100);
    pair.startAutoSync();
    for (let i = 0; i < seconds * 2; i++) {
        host.advance(500);
        if (i % 2 === 0) pair.reportLateness(lateness);
        pair.tick();
    }
}

describe('SplitAudioPair', () => {
    it('starts the sound session, mutes the picture and gives the sound the volume', () => {
        const { host, pair } = make();
        expect(pair.soundId).toBe('sound-1');
        expect(host.loaded).toEqual(['sound-1']);
        expect(host.volumes.get('main')).toBe(0);
        expect(host.volumes.get('sound-1')).toBe(80);
        expect(host.speeds.get('main')).toBe(1);
        expect(host.speeds.get('sound-1')).toBe(1);
    });

    it('starts the sound paused when the user is paused', () => {
        const { host } = make({ paused: true });
        expect(host.paused.get('sound-1')).toBe(true);
    });

    it('slows the muted picture when the sound is late, on top of the user speed', () => {
        const { host, pair } = make();
        converge(host, pair, 0.8);
        const status = pair.status();
        expect(status.correcting).toBe('main');
        expect(host.speeds.get('main') ?? 99).toBeLessThan(1);
        expect(host.speeds.get('sound-1')).toBe(1);
        expect(status.userSpeed).toBe(1);
    });

    it('slows the sound when it is early', () => {
        const { host, pair } = make();
        converge(host, pair, -0.6);
        expect(pair.status().correcting).toBe('sound');
        expect(host.speeds.get('sound-1') ?? 99).toBeLessThan(1);
        expect(host.speeds.get('main')).toBe(1);
    });

    it('keeps the user speed and the factor apart', () => {
        const { host, pair } = make();
        converge(host, pair, 0.8);
        const factor = host.speeds.get('main') ?? 0;
        pair.setUserSpeed(2);
        expect(host.speeds.get('main')).toBeCloseTo(2 * factor, 4);
        expect(host.speeds.get('sound-1')).toBe(2);
        expect(pair.status().userSpeed).toBe(2);
        pair.setUserSpeed(1);
        expect(host.speeds.get('main')).toBeCloseTo(factor, 4);
    });

    it('clamps the speed sent to mpv to its range', () => {
        expect(clampSpeed(8)).toBe(4);
        expect(clampSpeed(0.1)).toBe(0.25);
        const { host, pair } = make();
        pair.setUserSpeed(4);
        expect(host.speeds.get('sound-1')).toBe(4);
    });

    it('treats D_base as the target, so a sound that is only D_base late needs no correction', () => {
        const { host, pair } = make();
        converge(host, pair, D_BASE);
        expect(pair.status().correcting).toBeNull();
        expect(host.speeds.get('main')).toBe(1);
        expect(pair.status().state).toBe('synced');
    });

    it('moves the target with the trim and corrects towards it', () => {
        const { host, pair } = make();
        pair.setTrim(0.5);
        expect(pair.status().targetSeconds).toBeCloseTo(0.58, 5);
        converge(host, pair, 0.58);
        expect(pair.status().correcting).toBeNull();
    });

    it('lets the correction go on pause and measures again', () => {
        const { host, pair } = make();
        converge(host, pair, 0.8);
        expect(host.speeds.get('main') ?? 99).toBeLessThan(1);
        pair.onPause(true);
        expect(host.speeds.get('main')).toBe(1);
        expect(host.paused.get('sound-1')).toBe(true);
        expect(pair.status().state).toBe('paused');
        pair.onPause(false);
        expect(host.paused.get('sound-1')).toBe(false);
        expect(host.speeds.get('main')).toBe(1);
        expect(pair.status().correcting).toBeNull();
    });

    it('does not steer while paused', () => {
        const { host, pair } = make();
        pair.onPause(true);
        host.advance(SETTLE_MS.pause + 100);
        for (let i = 0; i < 10; i++) {
            pair.reportLateness(0.9);
            host.advance(500);
            pair.tick();
        }
        expect(host.speeds.get('main')).toBe(1);
    });

    it('sends a seek to the sound and drops the correction', () => {
        const { host, pair } = make();
        converge(host, pair, 0.8);
        pair.onSeekBy(-10);
        expect(host.seeks).toEqual([['sound-1', -10]]);
        expect(host.speeds.get('main')).toBe(1);
        // The run was cut by the seek: it says so and never starts again by itself.
        expect(pair.status().state).toBe('failed');
        expect(pair.status().sync?.failure).toBe('interrupted');
    });

    it('does not decide anything during the settle time after a reload', () => {
        const { host, pair } = make();
        pair.onMainReloaded();
        host.advance(1000);
        for (let i = 0; i < 6; i++) {
            pair.reportLateness(0.9);
            host.advance(200);
            pair.tick();
        }
        expect(host.speeds.get('main')).toBe(1);
    });

    it('unpauses the sound after its own reload, unless the user is paused', () => {
        const { host, pair } = make();
        host.paused.set('sound-1', true); // keep-open parked it at the old end
        pair.onSoundReloaded();
        expect(host.paused.get('sound-1')).toBe(false);
        pair.onPause(true);
        pair.onSoundReloaded();
        expect(host.paused.get('sound-1')).toBe(true);
    });

    it('re-sends the user speed after the sound reloads (mpv forgets it)', () => {
        const { host, pair } = make();
        pair.setUserSpeed(1.5);
        host.speedCalls = [];
        pair.onSoundReloaded();
        expect(host.speedCalls).toContainEqual(['sound-1', 1.5]);
    });

    it('applies the user volume to the sound only', () => {
        const { host, pair } = make();
        pair.setUserVolume(35);
        expect(host.volumes.get('sound-1')).toBe(35);
        expect(host.volumes.get('main')).toBe(0);
        expect(pair.volume).toBe(35);
    });

    describe('one decision source', () => {
        it('manual mode steers by the typed offset and ignores the clock readings', () => {
            const { host, pair } = make({ syncMode: 'manual' });
            expect(pair.status().syncMode).toBe('manual');
            converge(host, pair, 0.9); // OCR readings: ignored
            expect(pair.status().correcting).toBeNull();
            expect(host.speeds.get('main')).toBe(1);
            pair.reportManualLateness(0.9);
            pair.tick();
            expect(pair.status().correcting).toBe('main');
        });

        it('auto mode ignores a typed offset', () => {
            const { host, pair } = make();
            host.advance(SETTLE_MS.reload + 100);
            pair.reportManualLateness(0.9);
            pair.tick();
            expect(pair.status().correcting).toBeNull();
            expect(pair.status().syncMode).toBe('auto');
        });

        it('switching the mode throws away the old measurement and frees the speeds', () => {
            const { host, pair } = make();
            converge(host, pair, 0.8);
            expect(pair.status().correcting).toBe('main');
            pair.setSyncMode('manual');
            expect(pair.status().correcting).toBeNull();
            expect(host.speeds.get('main')).toBe(1);
            expect(pair.status().lateness).toBeNull();
        });

        it('a user trim moves the target only, never a speed', () => {
            const { host, pair } = make();
            converge(host, pair, 0.08); // on target: nothing slowed
            expect(pair.status().correcting).toBeNull();
            host.speedCalls = [];
            pair.setTrim(0.5);
            expect(host.speedCalls).toEqual([]);
            expect(pair.status().targetSeconds).toBeCloseTo(0.58, 5);
        });
    });

    it('hands the main session back on stop', () => {
        const { host, pair } = make({ userSpeed: 1.25 });
        converge(host, pair, 0.8);
        pair.stop();
        expect(host.speeds.get('main')).toBe(1.25);
        expect(host.volumes.get('main')).toBe(80);
        expect(host.disposed).toEqual(['sound-1']);
        expect(pair.soundId).toBeNull();
    });

    describe('audio health while slowing', () => {
        function stalled(
            host: FakeHost,
            pair: SplitAudioPair,
            startMs: number,
            seconds = 7
        ) {
            // the sound position freezes where it is
            const frozenAt =
                host.soundSnap?.positionSeconds ?? 100 + startMs / 1000;
            for (let i = 0; i < seconds * 2; i++) {
                host.advance(500);
                host.soundSnap = {
                    status: 'playing',
                    positionSeconds: frozenAt,
                    bufferedAheadSeconds: 2,
                    droppedFrames: 0,
                };
                pair.tick();
            }
        }

        function playingTicks(
            host: FakeHost,
            pair: SplitAudioPair,
            seconds: number
        ) {
            const t0 = host.clock;
            for (let i = 0; i < seconds * 2; i++) {
                host.advance(500);
                host.soundSnap = {
                    status: 'playing',
                    positionSeconds: 100 + (host.clock - t0) / 1000,
                    bufferedAheadSeconds: 2,
                    droppedFrames: 0,
                };
                pair.tick();
            }
        }

        it('releases the slowdown when the sound stalls', () => {
            const { host, pair, gaveUp } = make();
            converge(host, pair, -0.6); // slows the sound
            expect(pair.status().correcting).toBe('sound');
            playingTicks(host, pair, 4);
            stalled(host, pair, 0, 6);
            expect(host.speeds.get('sound-1')).toBe(1);
            expect(host.speeds.get('main')).toBe(1);
            expect(pair.status().issue).not.toBeNull();
            expect(gaveUp).toEqual([]);
        });

        it('releases the same way when the muted picture is the slowed one', () => {
            const { host, pair, gaveUp } = make();
            converge(host, pair, 0.8);
            expect(pair.status().correcting).toBe('main');
            playingTicks(host, pair, 4);
            stalled(host, pair, 0, 6);
            expect(host.speeds.get('main')).toBe(1);
            expect(host.speeds.get('sound-1')).toBe(1);
            expect(pair.status().correcting).toBeNull();
            expect(gaveUp).toEqual([]);
        });

        it('a manual pair lets go on a fault and waits for a new value', () => {
            const { host, pair } = make({ syncMode: 'manual' });
            host.advance(SETTLE_MS.reload + 100);
            pair.reportManualLateness(0.9);
            pair.tick();
            expect(pair.status().correcting).toBe('main');
            playingTicks(host, pair, 4);
            stalled(host, pair, 0, 6);
            expect(host.speeds.get('main')).toBe(1);
            expect(pair.status().lateness).toBeNull();
            host.advance(60_000);
            pair.tick();
            expect(pair.status().correcting).toBeNull();
        });

        it('gives the external sound up on a second stall within five minutes', () => {
            const { host, pair, gaveUp } = make();
            converge(host, pair, -0.6);
            playingTicks(host, pair, 4);
            stalled(host, pair, 0, 6);
            expect(gaveUp).toEqual([]);
            host.advance(60_000);
            playingTicks(host, pair, 30);
            stalled(host, pair, 0, 6);
            expect(gaveUp).toHaveLength(1);
            const status = pair.status();
            expect(status.autoDisabledReason).toBe(gaveUp[0]);
            expect(status.state).toBe('off');
            expect(host.speeds.get('sound-1')).toBe(1);
            expect(host.speeds.get('main')).toBe(1);
        });

        it('forgets a stall after five minutes', () => {
            const { host, pair, gaveUp } = make();
            converge(host, pair, -0.6);
            playingTicks(host, pair, 4);
            stalled(host, pair, 0, 6);
            host.advance(310_000);
            playingTicks(host, pair, 30);
            stalled(host, pair, 0, 6);
            expect(gaveUp).toEqual([]);
        });

        it('can be switched back on', () => {
            const { pair } = make();
            pair.setAutoCorrection(false);
            expect(pair.status().state).toBe('off');
            pair.setAutoCorrection(true);
            expect(pair.status().state).not.toBe('off');
            expect(pair.status().autoDisabledReason).toBeUndefined();
        });

        it('does not call a paused sound a stall', () => {
            const { host, pair } = make();
            pair.onPause(true);
            for (let i = 0; i < 20; i++) {
                host.advance(500);
                host.soundSnap = {
                    status: 'paused',
                    positionSeconds: 100,
                    bufferedAheadSeconds: 2,
                    droppedFrames: 0,
                };
                pair.tick();
            }
            expect(pair.status().issue).toBeNull();
        });
    });
});
