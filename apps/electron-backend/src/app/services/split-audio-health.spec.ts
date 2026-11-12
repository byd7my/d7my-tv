import {
    AudioHealthMonitor,
    AudioIssuePolicy,
    type HealthSample,
} from './split-audio-health';

function run(
    monitor: AudioHealthMonitor,
    seconds: number,
    make: (t: number) => Partial<HealthSample>,
    from = 0
) {
    let verdict = {
        issue: null as string | null,
        measuredRate: null as number | null,
    };
    for (let t = from; t < from + seconds; t += 0.5) {
        verdict = monitor.observe({
            now: t * 1000,
            status: 'playing',
            positionSeconds: t,
            speed: 1,
            bufferedAheadSeconds: 2,
            droppedFrames: 0,
            userPaused: false,
            steadySeconds: 60,
            ...make(t),
        });
    }
    return verdict;
}

describe('AudioHealthMonitor', () => {
    it('is quiet while the sound advances at its commanded speed', () => {
        const m = new AudioHealthMonitor();
        const v = run(m, 20, (t) => ({
            positionSeconds: t * 0.97,
            speed: 0.97,
        }));
        expect(v.issue).toBeNull();
        expect(v.measuredRate).toBeCloseTo(0.97, 2);
    });

    it('is not fooled by a position that only moves in quarter-second steps', () => {
        // the hidden sound session paints 4 frames a second, so mpv's position steps
        const m = new AudioHealthMonitor();
        for (const speed of [1, 0.97]) {
            m.reset();
            const v = run(m, 40, (t) => ({
                positionSeconds: Math.floor(t * speed * 4) / 4,
                speed,
            }));
            expect(v.issue).toBeNull();
        }
    });

    it('is not fooled by +-2% noise of a coarse position over a long correction', () => {
        const m = new AudioHealthMonitor();
        const v = run(m, 60, (t) => ({
            positionSeconds:
                Math.round((t * 0.97 + 0.15 * Math.sin(t * 1.7)) * 4) / 4,
            speed: 0.97,
        }));
        expect(v.issue).toBeNull();
    });

    it('reports a stall when the position stops moving', () => {
        const m = new AudioHealthMonitor();
        run(m, 5, (t) => ({ positionSeconds: t }));
        const v = run(m, 4, () => ({ positionSeconds: 5 }), 5);
        expect(v.issue).toBe('stall');
    });

    it('reports a rate mpv does not follow', () => {
        const m = new AudioHealthMonitor();
        // asked for 0.97, runs at 1.0
        const v = run(m, 20, (t) => ({ positionSeconds: t, speed: 0.97 }));
        expect(v.issue).toBe('rate');
        expect(v.measuredRate).toBeCloseTo(1, 2);
    });

    it('does not judge the rate right after a speed change', () => {
        const m = new AudioHealthMonitor();
        const v = run(m, 20, (t) => ({
            positionSeconds: t,
            speed: 0.97,
            steadySeconds: 2,
        }));
        expect(v.issue).toBeNull();
    });

    it('reports a starved buffer only once it lasts', () => {
        const m = new AudioHealthMonitor();
        expect(
            run(m, 2, (t) => ({
                positionSeconds: t,
                bufferedAheadSeconds: 0.1,
            })).issue
        ).toBeNull();
        expect(
            run(
                m,
                4,
                (t) => ({ positionSeconds: t, bufferedAheadSeconds: 0.1 }),
                2
            ).issue
        ).toBe('starving');
    });

    it('reports dropped frames', () => {
        const m = new AudioHealthMonitor();
        const v = run(m, 10, (t) => ({
            positionSeconds: t,
            droppedFrames: Math.floor(t * 4),
        }));
        expect(v.issue).toBe('drops');
    });

    it('treats a jump in position as a seek, not a stall', () => {
        const m = new AudioHealthMonitor();
        run(m, 5, (t) => ({ positionSeconds: t }));
        const v = run(m, 4, (t) => ({ positionSeconds: t + 100 }), 5);
        expect(v.issue).toBeNull();
    });

    it('says nothing while paused or not playing', () => {
        const m = new AudioHealthMonitor();
        expect(
            run(m, 6, () => ({ positionSeconds: 3, userPaused: true })).issue
        ).toBeNull();
        expect(
            run(m, 6, () => ({ positionSeconds: 3, status: 'loading' }), 6)
                .issue
        ).toBeNull();
    });
});

describe('AudioIssuePolicy', () => {
    it('releases on the first issue and gives up on the second inside five minutes', () => {
        const p = new AudioIssuePolicy();
        expect(p.onIssue(0)).toBe('release');
        expect(p.onIssue(299_000)).toBe('give-up');
    });

    it('forgets an issue after the window', () => {
        const p = new AudioIssuePolicy();
        expect(p.onIssue(0)).toBe('release');
        expect(p.onIssue(301_000)).toBe('release');
        p.reset();
        expect(p.onIssue(302_000)).toBe('release');
    });
});
