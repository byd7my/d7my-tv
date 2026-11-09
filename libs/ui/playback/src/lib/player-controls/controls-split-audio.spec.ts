import {
    Injector,
    runInInjectionContext,
    signal,
    type WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    SPLIT_AUDIO_OVERRIDE_BUILDER,
    SplitAudioService,
} from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { ControlsSplitAudio } from './controls-split-audio';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
} from './player-controls.model';

const channel = (name: string): Channel =>
    ({ id: name, name, url: `http://h/${name}.ts` }) as Channel;

describe('ControlsSplitAudio', () => {
    const video = channel('video');
    const commentary = channel('commentary');
    const setExternalAudio = jest.fn();
    const setExternalAudioDelay = jest.fn();
    let controls: ControlsSplitAudio;
    let state: WritableSignal<PlayerControlsState>;
    let service: SplitAudioService;
    let channelsBuilt: number;
    let opened: number;

    beforeEach(() => {
        localStorage.clear();
        setExternalAudio.mockClear();
        setExternalAudioDelay.mockClear();
        channelsBuilt = 0;
        opened = 0;
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SPLIT_AUDIO_OVERRIDE_BUILDER,
                    useValue: (c: Channel, delay: number) => ({
                        streamUrl: c.url,
                        title: c.name,
                        delaySeconds: delay,
                    }),
                },
            ],
        });
        service = TestBed.inject(SplitAudioService);
        service.setContext({
            video,
            channels: () => {
                channelsBuilt += 1;
                return [video, commentary];
            },
        });
        state = signal({ isLive: true } as PlayerControlsState);
        controls = runInInjectionContext(TestBed.inject(Injector), () =>
            new ControlsSplitAudio(
                state,
                () =>
                    ({
                        setExternalAudio,
                        setExternalAudioDelay,
                    }) as unknown as PlayerControlsCommands,
                () => (opened += 1)
            )
        );
    });

    it('does not build the channel list until the panel opens', () => {
        expect(controls.channels()).toEqual([]);
        expect(channelsBuilt).toBe(0);
        controls.open();
        expect(controls.panelOpen()).toBe(true);
        expect(opened).toBe(1);
        expect(controls.channels()).toHaveLength(2);
    });

    it('switches the audio without touching the picture and applies the saved delay', () => {
        service.saveDelay(video.url, commentary.url, 1.5);
        controls.open();
        controls.select(commentary);
        expect(setExternalAudio).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: commentary.url,
                isLive: true,
            }),
            1.5
        );
        expect(controls.activeAudio()?.title).toBe('commentary');
    });

    it('moves the delay in steps, applies it at once and saves only on request', () => {
        controls.select(commentary);
        controls.adjustDelay(1);
        controls.adjustDelay(0.5);
        expect(setExternalAudioDelay).toHaveBeenLastCalledWith(1.5);
        expect(service.savedDelay(video.url, commentary.url)).toBe(0);
        expect(controls.isDelaySaved()).toBe(false);
        controls.saveDelay();
        expect(service.savedDelay(video.url, commentary.url)).toBe(1.5);
        expect(controls.isDelaySaved()).toBe(true);
        controls.adjustDelay(-3);
        expect(setExternalAudioDelay).toHaveBeenLastCalledWith(-1.5);
        expect(controls.isDelaySaved()).toBe(false);
    });

    it('goes back to the original audio', () => {
        controls.select(commentary);
        controls.clear();
        expect(setExternalAudio).toHaveBeenLastCalledWith(null, 0);
        expect(controls.activeAudio()).toBeNull();
    });

    it('is only offered for live playback with a published context', () => {
        expect(controls.available()).toBe(true);
        service.setContext(null);
        expect(controls.available()).toBe(false);
    });

    it('drops the selected audio when its channel fails to open', () => {
        controls.select(commentary);
        expect(controls.activeAudio()).not.toBeNull();
        state.update((value) => ({
            ...value,
            externalAudioError: 'loading failed',
        }));
        TestBed.tick();
        expect(controls.error()).toBe('loading failed');
        expect(controls.activeAudio()).toBeNull();
    });
});
