import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AudioSyncController } from '../audio-sync/audio-sync.controller';
import { ControlsSplitSync } from './controls-split-sync';
import type { PlayerControlsState } from './player-controls.model';

describe('ControlsSplitSync', () => {
    let state: ReturnType<typeof signal<PlayerControlsState>>;
    let audioUrl: ReturnType<typeof signal<string | null>>;
    let on: boolean;
    let sync: {
        shutdown: jest.Mock;
        startAuto: jest.Mock;
        dropReadings: jest.Mock;
    };
    let commands: {
        reportSplitAudioLateness: jest.Mock;
        setSplitAudioSyncMode: jest.Mock;
        splitAudioSyncAction: jest.Mock;
    };
    let ctl: ControlsSplitSync;

    beforeEach(() => {
        state = signal({} as PlayerControlsState);
        audioUrl = signal<string | null>('http://audio/1');
        on = true;
        sync = {
            shutdown: jest.fn(),
            startAuto: jest.fn(() => true),
            dropReadings: jest.fn(),
        };
        commands = {
            reportSplitAudioLateness: jest.fn(),
            setSplitAudioSyncMode: jest.fn(),
            splitAudioSyncAction: jest.fn(),
        };
        TestBed.runInInjectionContext(() => {
            ctl = new ControlsSplitSync(
                state,
                () => commands as never,
                sync as unknown as AudioSyncController,
                () => on,
                audioUrl
            );
        });
        TestBed.tick();
        sync.shutdown.mockClear();
    });

    it('auto start reads the clocks in the background and tells the backend the mode', () => {
        ctl.start();
        expect(commands.setSplitAudioSyncMode).toHaveBeenCalledWith('auto');
        expect(sync.startAuto).toHaveBeenCalled();
        expect(commands.splitAudioSyncAction).toHaveBeenCalledWith('start');
        expect(commands.reportSplitAudioLateness).not.toHaveBeenCalled();
        expect(ctl.barVisible()).toBe(true);
    });

    it('manual sends the typed offset as a manual value: picture ahead means the sound is late', () => {
        ctl.setMode('manual');
        ctl.start();
        expect(sync.startAuto).not.toHaveBeenCalled();
        ctl.setManualSeconds(10);
        expect(commands.reportSplitAudioLateness).toHaveBeenLastCalledWith(
            10,
            true
        );
        ctl.setManualLead('audio');
        expect(commands.reportSplitAudioLateness).toHaveBeenLastCalledWith(
            -10,
            true
        );
    });

    it('fine steps move the signed offset and flip the side across zero', () => {
        ctl.setMode('manual');
        ctl.start();
        ctl.setManualSeconds(0.2);
        ctl.nudgeManual(-0.1);
        expect(ctl.manualLateness()).toBeCloseTo(0.1, 5);
        ctl.nudgeManual(-0.3);
        expect(ctl.manualLead()).toBe('audio');
        expect(ctl.manualSeconds()).toBeCloseTo(0.2, 5);
        expect(commands.reportSplitAudioLateness).toHaveBeenLastCalledWith(
            -0.2,
            true
        );
    });

    it('switching to manual stops reading the clocks; back to auto waits for Sync', () => {
        ctl.start();
        sync.startAuto.mockClear();
        ctl.setMode('manual');
        expect(sync.shutdown).toHaveBeenCalled();
        expect(commands.setSplitAudioSyncMode).toHaveBeenLastCalledWith(
            'manual'
        );
        ctl.setMode('auto');
        expect(commands.setSplitAudioSyncMode).toHaveBeenLastCalledWith('auto');
        // a mode change is not a press of Sync: nothing is read or run
        expect(sync.startAuto).not.toHaveBeenCalled();
        expect(ctl.started()).toBe(false);
    });

    it('sends nothing manual before the sync is started or in auto', () => {
        ctl.setMode('manual');
        ctl.setManualSeconds(5);
        expect(commands.reportSplitAudioLateness).not.toHaveBeenCalled();
        ctl.setMode('auto');
        ctl.start();
        ctl.setManualSeconds(5);
        expect(commands.reportSplitAudioLateness).not.toHaveBeenCalled();
    });

    it('re-sends the typed offset on demand', () => {
        ctl.setMode('manual');
        ctl.start();
        ctl.setManualSeconds(3);
        commands.reportSplitAudioLateness.mockClear();
        ctl.applyManual();
        expect(commands.reportSplitAudioLateness).toHaveBeenCalledWith(3, true);
    });

    it('stop and a cleared audio channel both stop the reading', () => {
        ctl.start();
        ctl.stop();
        expect(ctl.started()).toBe(false);
        expect(sync.shutdown).toHaveBeenCalled();
        ctl.start();
        sync.shutdown.mockClear();
        audioUrl.set(null);
        TestBed.tick();
        expect(ctl.started()).toBe(false);
        expect(sync.shutdown).toHaveBeenCalled();
    });

    it('shows the bar with a notice when the external sound was given up, until dismissed', () => {
        on = false;
        audioUrl.set(null);
        state.set({ splitAudioNotice: 'stalled' } as PlayerControlsState);
        TestBed.tick();
        expect(ctl.barVisible()).toBe(true);
        expect(ctl.notice()).toBe('stalled');
        ctl.dismissNotice();
        expect(ctl.barVisible()).toBe(false);
    });

    describe('Auto Sync is one run', () => {
        const status = (sync: Record<string, unknown>) =>
            ({
                splitAudio: { sync, state: 'idle' },
            }) as unknown as PlayerControlsState;
        const phase = (p: string, extra: Record<string, unknown> = {}) =>
            state.set(status({ phase: p, epoch: 0, ...extra }));

        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('stops reading the clocks when the run is done', () => {
            ctl.start();
            phase('measuring');
            TestBed.tick();
            expect(sync.shutdown).not.toHaveBeenCalled();
            phase('done');
            TestBed.tick();
            expect(sync.shutdown).toHaveBeenCalledTimes(1);
            // the bar stays to say "synced", but nothing reads or runs any more
            expect(ctl.started()).toBe(true);
            expect(ctl.ended()).toBe(true);
        });

        it('stops reading when the run failed too', () => {
            ctl.start();
            phase('freezing');
            TestBed.tick();
            phase('failed', { failure: 'timeout' });
            TestBed.tick();
            expect(sync.shutdown).toHaveBeenCalledTimes(1);
        });

        it('does not stop on the idle state seen before the run was picked up', () => {
            ctl.start();
            phase('idle');
            TestBed.tick();
            expect(sync.shutdown).not.toHaveBeenCalled();
        });

        it('gives up the reading when the backend never starts the run', () => {
            ctl.start();
            phase('idle');
            TestBed.tick();
            jest.advanceTimersByTime(7000);
            expect(sync.shutdown).toHaveBeenCalled();
        });

        it('Sync again after the end runs once more, and only then', () => {
            ctl.start();
            phase('measuring');
            TestBed.tick();
            phase('done');
            TestBed.tick();
            commands.splitAudioSyncAction.mockClear();
            sync.startAuto.mockClear();
            ctl.runAgain();
            expect(sync.startAuto).toHaveBeenCalledTimes(1);
            expect(commands.splitAudioSyncAction).toHaveBeenCalledWith('start');
        });

        it('the main button reads Stop while it runs and Sync now after the end', () => {
            ctl.start();
            phase('measuring');
            TestBed.tick();
            expect(ctl.stopShown()).toBe(true);
            phase('done');
            TestBed.tick();
            expect(ctl.stopShown()).toBe(false);
            sync.startAuto.mockClear();
            ctl.press();
            expect(sync.startAuto).toHaveBeenCalledTimes(1);
        });

        it('drops the smoothed clocks when a freeze ends', () => {
            ctl.start();
            phase('freezing', { epoch: 0 });
            TestBed.tick();
            phase('settling', { epoch: 1 });
            TestBed.tick();
            expect(sync.dropReadings).toHaveBeenCalledTimes(1);
            phase('fine', { epoch: 1 });
            TestBed.tick();
            expect(sync.dropReadings).toHaveBeenCalledTimes(1);
        });

        it('stop cancels the run in the backend', () => {
            ctl.start();
            ctl.stop();
            expect(commands.splitAudioSyncAction).toHaveBeenLastCalledWith(
                'cancel'
            );
        });

        it('quick sync and the picture-audio choice are plain commands', () => {
            ctl.quickSync();
            expect(commands.splitAudioSyncAction).toHaveBeenLastCalledWith(
                'quick'
            );
            ctl.setOriginalAudio(true);
            expect(commands.splitAudioSyncAction).toHaveBeenLastCalledWith(
                'original-audio-on'
            );
            ctl.setOriginalAudio(false);
            expect(commands.splitAudioSyncAction).toHaveBeenLastCalledWith(
                'original-audio-off'
            );
        });

        it('tells a voided manual correction only in manual mode', () => {
            state.set({
                splitAudio: { manualVoided: 'pause' },
            } as unknown as PlayerControlsState);
            expect(ctl.manualVoided()).toBeNull();
            ctl.setMode('manual');
            expect(ctl.manualVoided()).toBe('pause');
        });
    });
});
