import {
    Injector,
    runInInjectionContext,
    signal,
    type WritableSignal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    SPLIT_AUDIO_OVERRIDE_BUILDER,
    SplitAudioService,
} from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { ControlsSplitAudio } from '../controls-split-audio';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
} from '../player-controls.model';
import { SplitAudioPanelComponent } from './split-audio-panel.component';

const channel = (name: string): Channel =>
    ({ id: name, name, url: `http://h/${name}.ts` }) as Channel;

describe('SplitAudioPanelComponent', () => {
    const video = channel('Video One');
    const channels = [
        video,
        channel('Alwan Sport'),
        channel('Alwan 1'),
        channel('Alwan 2'),
    ];
    const setExternalAudio = jest.fn();
    const setExternalAudioDelay = jest.fn();
    let fixture: ComponentFixture<SplitAudioPanelComponent>;
    let controls: ControlsSplitAudio;
    let service: SplitAudioService;
    let state: WritableSignal<PlayerControlsState>;

    const root = () => fixture.nativeElement as HTMLElement;
    const names = () =>
        Array.from(root().querySelectorAll('.split-audio__name')).map((el) =>
            el.textContent?.trim()
        );
    const click = (selector: string, index = 0) => {
        (root().querySelectorAll(selector)[index] as HTMLElement).click();
        fixture.detectChanges();
    };

    beforeEach(() => {
        localStorage.clear();
        setExternalAudio.mockClear();
        setExternalAudioDelay.mockClear();
        TestBed.configureTestingModule({
            imports: [SplitAudioPanelComponent, TranslateModule.forRoot()],
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
        service.setContext({ video, channels: () => channels });
        state = signal({ isLive: true } as PlayerControlsState);
        controls = runInInjectionContext(TestBed.inject(Injector), () =>
            new ControlsSplitAudio(
                state,
                () =>
                    ({
                        setExternalAudio,
                        setExternalAudioDelay,
                    }) as unknown as PlayerControlsCommands
            )
        );
        controls.open();
        fixture = TestBed.createComponent(SplitAudioPanelComponent);
        fixture.componentRef.setInput('controls', controls);
        fixture.detectChanges();
    });

    it('shows favorites first and no other channel until searched', () => {
        expect(names()).toEqual([]);
        service.toggleFavorite(channels[2].url, 'audio');
        fixture.detectChanges();
        expect(names()).toEqual(['Alwan 1']);
    });

    it('finds channels by typing and never lists the video channel', () => {
        click('[data-test-id="split-audio-search-toggle"]');
        const input = root().querySelector(
            '[data-test-id="split-audio-search"]'
        ) as HTMLInputElement;
        input.value = 'alwan';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(names()).toEqual(['Alwan Sport', 'Alwan 1', 'Alwan 2']);
        input.value = 'video';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(names()).toEqual([]);
    });

    it('plays the picked channel, highlights it and offers the delay controls', () => {
        click('[data-test-id="split-audio-search-toggle"]');
        const input = root().querySelector(
            '[data-test-id="split-audio-search"]'
        ) as HTMLInputElement;
        input.value = 'alwan 2';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        click('[data-test-id="split-audio-channel"]');
        expect(setExternalAudio).toHaveBeenCalledTimes(1);
        expect(root().querySelector('.split-audio__row--active')).not.toBeNull();

        click('[data-test-id="split-audio-delay-plus"]');
        expect(setExternalAudioDelay).toHaveBeenLastCalledWith(1);
        expect(
            root().querySelector('[data-test-id="split-audio-delay"]')?.textContent
        ).toContain('+1');
        click('.split-audio__chip', 2); // 5 s step
        click('[data-test-id="split-audio-delay-minus"]');
        expect(setExternalAudioDelay).toHaveBeenLastCalledWith(-4);
    });

    it('goes back to the original audio', () => {
        service.toggleFavorite(channels[3].url, 'audio');
        fixture.detectChanges();
        click('[data-test-id="split-audio-channel"]');
        click('[data-test-id="split-audio-original"]');
        expect(setExternalAudio).toHaveBeenLastCalledWith(null, 0);
        expect(root().querySelector('[data-test-id="split-audio-original"]')).toBeNull();
    });

    it('keeps typing away from the player shortcuts and closes on Escape', () => {
        let closed = 0;
        fixture.componentInstance.closed.subscribe(() => (closed += 1));
        const event = new KeyboardEvent('keydown', {
            key: 'f',
            bubbles: true,
        });
        const outer = jest.fn();
        document.addEventListener('keydown', outer);
        root().dispatchEvent(event);
        document.removeEventListener('keydown', outer);
        expect(outer).not.toHaveBeenCalled();
        root().dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        expect(closed).toBe(1);
    });

    it('tells the user when the audio channel failed, without touching the picture', () => {
        expect(root().querySelector('[data-test-id="split-audio-error"]')).toBeNull();
        state.update((value) => ({ ...value, externalAudioError: 'failed' }));
        fixture.detectChanges();
        expect(root().querySelector('[data-test-id="split-audio-error"]')).not.toBeNull();
    });
});
