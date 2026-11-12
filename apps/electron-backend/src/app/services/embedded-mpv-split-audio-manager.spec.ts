import type {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    EmbeddedMpvSplitAudioManager,
    SOUND_REPLACE_SETTLE_MS,
    type SplitAudioAddon,
    type SplitAudioManagerDeps,
} from './embedded-mpv-split-audio-manager';

const PLAYBACK = {
    streamUrl: 'http://example.test/b.ts',
} as ResolvedPortalPlayback;
const OPTIONS = { extraOptions: ['network-timeout=5'], autoReconnect: true };

interface Snap {
    status: string;
    positionSeconds: number;
    volume: number;
    playbackSpeed?: number;
    stats?: {
        bufferedAheadSeconds?: number;
        droppedFrames?: number;
        videoBitrateBps?: number;
    };
}

function setup(frameCopy = true) {
    const snaps = new Map<string, Snap>([
        [
            'main',
            {
                status: 'playing',
                positionSeconds: 100,
                volume: 70,
                playbackSpeed: 1.25,
            },
        ],
    ]);
    const calls: string[] = [];
    const created: Array<{ options: string[]; volume: number }> = [];
    let createFails = false;
    let clock = 1_000_000;
    const addon: SplitAudioAddon = {
        setPaused: (id, p) => {
            calls.push(`hold:${id}:${p}`);
            const snap = snaps.get(id);
            if (snap) snap.status = p ? 'paused' : 'playing';
        },
        seek: (id, s) => void calls.push(`seek:${id}:${s}`),
        seekBy: (id, d) => void calls.push(`jump:${id}:${d}`),
        // like the real session: what was set is what the snapshot reports afterwards
        setSpeed: (id, s) => {
            calls.push(`speed:${id}:${s}`);
            const snap = snaps.get(id);
            if (snap) snap.playbackSpeed = s;
        },
        setVolume: (id, v) => {
            calls.push(`volume:${id}:${v}`);
            const snap = snaps.get(id);
            if (snap) snap.volume = v;
        },
        getSessionSnapshot: (id) => snaps.get(id) ?? null,
    };
    const deps: SplitAudioManagerDeps = {
        addon: () => addon,
        usesFrameCopy: () => frameCopy,
        now: () => clock,
        createSession: (_b, _t, volume, options) => {
            if (createFails) throw new Error('too many connections');
            created.push({ options: options.extraOptions, volume });
            snaps.set('sound', {
                status: 'loading',
                positionSeconds: 0,
                volume: 0,
            });
            return 'sound';
        },
        loadPlayback: (id) => void calls.push(`load:${id}`),
        setPaused: (id, p) => void calls.push(`pause:${id}:${p}`),
        seekBy: (id, d) => void calls.push(`seekBy:${id}:${d}`),
        disposeSession: (id) => void calls.push(`dispose:${id}`),
        warn: () => undefined,
    };
    const manager = new EmbeddedMpvSplitAudioManager(deps);
    return {
        manager,
        calls,
        created,
        snaps,
        failCreate: () => (createFails = true),
        advance: (ms: number) => void (clock += ms),
    };
}

function payload(
    id: string,
    extra: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id,
        title: '',
        streamUrl: '',
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 0,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        startedAt: '',
        updatedAt: '',
        ...extra,
    };
}

describe('EmbeddedMpvSplitAudioManager', () => {
    it('leaves the audio-add path alone when the session was not permitted', () => {
        const { manager, created } = setup();
        expect(manager.setExternalAudio('main', PLAYBACK, 0)).toBe(false);
        expect(created).toHaveLength(0);
        expect(manager.onSetSpeed('main', 2)).toBe(false);
        expect(manager.onSetVolume('main', 10)).toBe(false);
        expect(manager.setExternalAudioDelay('main', 0.2)).toBe(false);
    });

    it('falls back to audio-add on an engine that is not frame-copy', () => {
        const { manager, created } = setup(false);
        manager.allow('main', OPTIONS);
        expect(manager.setExternalAudio('main', PLAYBACK, 0)).toBe(false);
        expect(created).toHaveLength(0);
    });

    it('falls back to audio-add when the sound session cannot be created', () => {
        const { manager, failCreate, calls } = setup();
        manager.allow('main', OPTIONS);
        failCreate();
        expect(manager.setExternalAudio('main', PLAYBACK, 0)).toBe(false);
        expect(manager.pairOf('main')).toBeUndefined();
        // the picture keeps its own sound: nothing was muted
        expect(calls).not.toContain('volume:main:0');
    });

    it('creates a hidden sound session with the user options and a tiny picture', () => {
        const { manager, created, calls } = setup();
        manager.allow('main', OPTIONS);
        expect(manager.setExternalAudio('main', PLAYBACK, 0.1)).toBe(true);
        expect(created[0].options).toEqual(
            expect.arrayContaining(['network-timeout=5', 'hwdec=auto-copy'])
        );
        expect(
            created[0].options.some((o) => o.startsWith('vf=lavfi=[fps='))
        ).toBe(true);
        expect(calls).toContain('load:sound');
        expect(calls).toContain('volume:main:0');
        expect(calls).toContain('volume:sound:70');
        // the user's speed (1.25) is what both sessions start at
        expect(calls).toContain('speed:main:1.25');
        expect(calls).toContain('speed:sound:1.25');
        expect(manager.isSoundSession('sound')).toBe(true);
    });

    it('routes speed and volume to the pair and reports the user values', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        calls.length = 0;
        expect(manager.onSetSpeed('main', 2)).toBe(true);
        expect(calls).toEqual(['speed:main:2', 'speed:sound:2']);
        calls.length = 0;
        expect(manager.onSetVolume('main', 30)).toBe(true);
        expect(calls).toEqual(['volume:sound:30']);
        const p = payload('main');
        manager.decorate(p);
        expect(p.volume).toBe(30);
        expect(p.playbackSpeed).toBe(2);
        expect(p.splitAudio?.mode).toBe('dual-session');
        expect(p.splitAudio?.soundSessionId).toBe('sound');
    });

    it('sends pause and seeks to both sessions', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        calls.length = 0;
        manager.onSetPaused('main', true);
        expect(calls).toContain('pause:sound:true');
        manager.onSeekBy('main', -10);
        expect(calls).toContain('seekBy:sound:-10');
        calls.length = 0;
        manager.onSeekTo('main', 130); // main is at 100
        expect(calls).toContain('seekBy:sound:30');
    });

    it('keeps a paused pair paused across a reload and clears the keep-open pause otherwise', () => {
        const { manager } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        expect(manager.pausedAfterReload('sound')).toBe(false);
        manager.onSetPaused('main', true);
        expect(manager.pausedAfterReload('sound')).toBe(true);
        expect(manager.pausedAfterReload('main')).toBe(true);
        expect(manager.pausedAfterReload('unrelated')).toBe(false);
    });

    it('unpauses the sound session after it reloads into playing', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        calls.length = 0;
        manager.onStatus('sound', 'playing', 'error', true);
        expect(calls).toContain('pause:sound:false');
    });

    it('measures again when the picture session reloads', () => {
        const { manager } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        const pair = manager.pairOf('main');
        if (!pair) throw new Error('no pair');
        const spy = jest.spyOn(pair, 'onMainReloaded');
        manager.onStatus('main', 'playing', 'loading', false);
        expect(spy).toHaveBeenCalledTimes(1);
        manager.onStatus('main', 'playing', 'playing', false);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    describe('the sync freeze', () => {
        function frozenPicture() {
            const ctx = setup();
            const { manager, snaps, advance } = ctx;
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            snaps.set('sound', {
                status: 'playing',
                positionSeconds: 100,
                volume: 0,
                stats: { bufferedAheadSeconds: 3, videoBitrateBps: 6_000_000 },
            });
            snaps.get('main')!.stats = {
                bufferedAheadSeconds: 3,
                videoBitrateBps: 6_000_000,
            };
            const pair = manager.pairOf('main');
            if (!pair) throw new Error('no pair');
            // 15 s ahead picture: steady readings until the run freezes it
            for (let i = 0; i < 80 && !pair.pictureFrozen; i++) {
                advance(500);
                const sound = snaps.get('sound');
                if (sound) sound.positionSeconds += 0.5;
                if (i === 0) manager.syncAction('main', 'start');
                if (i % 2 === 0) manager.report('main', 15, false);
                manager.tick();
            }
            return { ...ctx, pair };
        }

        it('shows the frozen picture as playing, not as a user pause', () => {
            const { manager, pair, snaps } = frozenPicture();
            expect(pair.pictureFrozen).toBe(true);
            // the helper really paused the picture session, below the user's pause
            expect(snaps.get('main')?.status).toBe('paused');
            const p = payload('main', { status: 'paused' });
            manager.decorate(p);
            expect(p.status).toBe('playing');
            expect(p.splitAudio?.state).toBe('freezing');
            expect(p.splitAudio?.sync?.side).toBe('picture');
        });

        it('does not show a user pause as playing', () => {
            const { manager } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            const p = payload('main', { status: 'paused' });
            manager.decorate(p);
            expect(p.status).toBe('paused');
        });

        it('does not take its own resume for a reload of the picture or the sound', () => {
            const { manager, pair } = frozenPicture();
            const picture = jest.spyOn(pair, 'onMainReloaded');
            manager.onStatus('main', 'playing', 'paused', false);
            expect(picture).not.toHaveBeenCalled();
            const sound = jest.spyOn(pair, 'onSoundReloaded');
            manager.onStatus('sound', 'playing', 'paused', false);
            // the sound was not held: a real reload of it is still a reload
            expect(sound).toHaveBeenCalledTimes(1);
        });

        it('keeps the choice of the picture audio across a replaced sound', () => {
            const { manager } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            expect(manager.syncAction('main', 'original-audio-on')).toBe(true);
            expect(
                manager.pairOf('main')?.status().originalAudioDuringFreeze
            ).toBe(true);
        });

        it('answers false for a session without a pair', () => {
            const { manager } = setup();
            expect(manager.syncAction('main', 'start')).toBe(false);
        });
    });

    it('stops the pair on a user load and hands the picture its sound back', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        calls.length = 0;
        manager.onUserLoad('main');
        expect(calls).toEqual([
            'speed:main:1.25',
            'volume:main:70',
            'dispose:sound',
        ]);
        expect(manager.pairOf('main')).toBeUndefined();
        expect(manager.onSetSpeed('main', 1)).toBe(false);
    });

    it('stops the pair when audio is removed', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        expect(manager.setExternalAudio('main', null, 0)).toBe(true);
        expect(calls).toContain('dispose:sound');
        expect(manager.setExternalAudio('main', null, 0)).toBe(false);
    });

    it('replaces the pair after the old connection had time to close, keeping the picture muted', () => {
        jest.useFakeTimers();
        try {
            const { manager, calls, created } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            calls.length = 0;
            expect(manager.setExternalAudio('main', PLAYBACK, 0)).toBe(true);
            expect(calls).toContain('dispose:sound');
            // not unmuted in between, and not reopened at once
            expect(calls).not.toContain('volume:main:70');
            expect(created).toHaveLength(1);
            expect(manager.pairOf('main')).toBeUndefined();
            jest.advanceTimersByTime(SOUND_REPLACE_SETTLE_MS);
            expect(created).toHaveLength(2);
            expect(manager.pairOf('main')).toBeDefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it("gives the replacement sound the volume and speed the user chose, not the muted picture's", () => {
        jest.useFakeTimers();
        try {
            const { manager, calls, created } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            manager.onSetVolume('main', 55);
            manager.onSetSpeed('main', 1.5);
            calls.length = 0;
            manager.setExternalAudio('main', PLAYBACK, 0);
            // the user moves the volume while the old connection closes: it must not unmute the picture
            expect(manager.onSetVolume('main', 40)).toBe(true);
            expect(manager.onSetSpeed('main', 1.25)).toBe(true);
            expect(calls).not.toContain('volume:main:40');
            jest.advanceTimersByTime(SOUND_REPLACE_SETTLE_MS);
            expect(created).toHaveLength(2);
            expect(created[1].volume).toBe(0);
            const pair = manager.pairOf('main');
            expect(pair?.volume).toBe(40);
            expect(pair?.speed).toBe(1.25);
            expect(calls).toContain('volume:sound:40');
        } finally {
            jest.useRealTimers();
        }
    });

    it('drops a replacement that is still waiting when the user loads another picture', () => {
        jest.useFakeTimers();
        try {
            const { manager, created } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            manager.setExternalAudio('main', PLAYBACK, 0);
            manager.onUserLoad('main');
            jest.advanceTimersByTime(SOUND_REPLACE_SETTLE_MS * 2);
            expect(created).toHaveLength(1);
            expect(manager.pairOf('main')).toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it('crops the hidden picture to the clock region and keeps the sound audible', () => {
        const { manager, created } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio(
            'main',
            {
                ...PLAYBACK,
                clockRegion: { x: 0, y: 0, width: 0.4, height: 0.1 },
            },
            0
        );
        const options = created[0].options;
        expect(options.some((o) => o.startsWith('vf=lavfi=[crop='))).toBe(true);
        for (const silenced of ['ao=null', 'aid=no', 'mute=yes']) {
            expect(options).not.toContain(silenced);
        }
    });

    it('marks the sessions that may use the mode', () => {
        const { manager } = setup();
        const before = payload('main');
        manager.decorate(before);
        expect(before.splitAudioEnabled).toBeUndefined();
        manager.allow('main', OPTIONS);
        const after = payload('main');
        manager.decorate(after);
        expect(after.splitAudioEnabled).toBe(true);
        expect(after.splitAudio).toBeUndefined();
    });

    it('ends the pair and reports an error when the sound session dies for good', () => {
        jest.useFakeTimers();
        try {
            const { manager, calls } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            manager.onStatus('sound', 'error', 'playing', false);
            jest.runAllTimers();
            expect(manager.pairOf('main')).toBeUndefined();
            expect(calls).toContain('volume:main:70');
            const p = payload('main');
            manager.decorate(p);
            expect(p.externalAudioError).toBeDefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not end the pair while the sound session is still reconnecting', () => {
        jest.useFakeTimers();
        try {
            const { manager } = setup();
            manager.allow('main', OPTIONS);
            manager.setExternalAudio('main', PLAYBACK, 0);
            manager.onStatus('sound', 'error', 'playing', true);
            jest.runAllTimers();
            expect(manager.pairOf('main')).toBeDefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it('ends the pair without disposing twice when the sound session is disposed from outside', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        calls.length = 0;
        manager.onDispose('sound');
        expect(manager.pairOf('main')).toBeUndefined();
        expect(calls).not.toContain('dispose:sound');
        expect(calls).toContain('volume:main:70');
    });

    it('disposes the sound session with the picture session', () => {
        const { manager, calls } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        calls.length = 0;
        manager.onDispose('main');
        expect(calls).toContain('dispose:sound');
        expect(manager.pairOf('main')).toBeUndefined();
        expect(manager.setExternalAudio('main', PLAYBACK, 0)).toBe(false);
    });

    it('passes the trim and measurements through to the pair', () => {
        const { manager } = setup();
        manager.allow('main', OPTIONS, 0.08);
        manager.setExternalAudio('main', PLAYBACK, 0);
        manager.setExternalAudioDelay('main', 0.25);
        const p = payload('main');
        manager.decorate(p);
        expect(p.splitAudio?.trimSeconds).toBeCloseTo(0.25, 5);
        expect(p.splitAudio?.targetSeconds).toBeCloseTo(0.33, 5);
        expect(manager.report('main', 0.5, false)).toBe(true);
        expect(manager.report('main', 0.5, true)).toBe(true);
        expect(manager.report('other', 0.5, false)).toBe(false);
        expect(manager.setAuto('main', false)).toBe(true);
    });

    it('ticks every pair and survives a failing one', () => {
        const { manager, snaps } = setup();
        manager.allow('main', OPTIONS);
        manager.setExternalAudio('main', PLAYBACK, 0);
        snaps.delete('sound');
        expect(() => manager.tick()).not.toThrow();
    });

    describe('sync mode and safety policy', () => {
        function frozen(
            env: ReturnType<typeof setup>,
            fromPosition: number,
            seconds: number
        ) {
            for (let i = 0; i < seconds * 2; i++) {
                env.advance(500);
                env.snaps.set('sound', {
                    status: 'playing',
                    positionSeconds: fromPosition,
                    volume: 70,
                    stats: { bufferedAheadSeconds: 2, droppedFrames: 0 },
                });
                env.manager.tick();
            }
        }

        function playing(
            env: ReturnType<typeof setup>,
            fromPosition: number,
            seconds: number
        ) {
            for (let i = 0; i < seconds * 2; i++) {
                env.advance(500);
                env.snaps.set('sound', {
                    status: 'playing',
                    positionSeconds: fromPosition + (i + 1) / 2,
                    volume: 70,
                    stats: { bufferedAheadSeconds: 2, droppedFrames: 0 },
                });
                env.manager.tick();
            }
        }

        it('keeps the chosen mode and shows it in the status', () => {
            const env = setup();
            env.manager.allow('main', OPTIONS);
            expect(env.manager.setSyncMode('main', 'manual')).toBe(true);
            env.manager.setExternalAudio('main', PLAYBACK, 0);
            const p = payload('main');
            env.manager.decorate(p);
            expect(p.splitAudio?.syncMode).toBe('manual');
            env.manager.setSyncMode('main', 'auto');
            env.manager.decorate(p);
            expect(p.splitAudio?.syncMode).toBe('auto');
            expect(env.manager.setSyncMode('unknown', 'auto')).toBe(false);
        });

        it('lets only the active source steer', () => {
            const env = setup();
            env.manager.allow('main', OPTIONS);
            env.manager.setExternalAudio('main', PLAYBACK, 0);
            env.advance(6000);
            env.manager.setSyncMode('main', 'manual');
            env.advance(6000);
            env.manager.report('main', 0.9, false); // a clock reading
            env.manager.tick();
            const p = payload('main');
            env.manager.decorate(p);
            expect(p.splitAudio?.lateness).toBeNull();
            env.manager.report('main', 0.9, true); // the typed offset
            env.manager.tick();
            env.manager.decorate(p);
            expect(p.splitAudio?.correcting).toBe('main');
        });

        it('on a second stall closes the sound session and gives the picture its audio back with a notice', () => {
            jest.useFakeTimers();
            try {
                const env = setup();
                env.manager.allow('main', OPTIONS);
                env.manager.setExternalAudio('main', PLAYBACK, 0);
                playing(env, 10, 6);
                frozen(env, 16, 6);
                expect(env.manager.pairOf('main')).toBeDefined();
                playing(env, 16, 30);
                frozen(env, 46, 6);
                jest.runAllTimers();
                expect(env.manager.pairOf('main')).toBeUndefined();
                expect(env.calls).toContain('dispose:sound');
                expect(env.calls).toContain('volume:main:70');
                const p = payload('main');
                env.manager.decorate(p);
                expect(p.splitAudioNotice).toBe('stalled');
                expect(p.externalAudioError).toBeDefined();
            } finally {
                jest.useRealTimers();
            }
        });

        it('refuses the clock preview while the two-session mode is on', () => {
            const env = setup();
            expect(env.manager.previewAllowed()).toBe(true);
            env.manager.allow('main', OPTIONS);
            expect(env.manager.previewAllowed()).toBe(false);
            env.manager.setExternalAudio('main', PLAYBACK, 0);
            expect(env.manager.previewAllowed()).toBe(false);
            env.manager.onDispose('main');
            expect(env.manager.previewAllowed()).toBe(true);
        });

        it('never opens a second sound session for one picture', () => {
            const env = setup();
            env.manager.allow('main', OPTIONS);
            env.manager.setExternalAudio('main', PLAYBACK, 0);
            const before = env.created.length;
            // a direct second start is turned into a replacement, not a new connection
            jest.useFakeTimers();
            try {
                env.manager.setExternalAudio('main', PLAYBACK, 0);
                expect(
                    env.calls.filter((c) => c === 'dispose:sound')
                ).toHaveLength(1);
                expect(env.created).toHaveLength(before);
                jest.advanceTimersByTime(SOUND_REPLACE_SETTLE_MS + 10);
                expect(env.created).toHaveLength(before + 1);
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
