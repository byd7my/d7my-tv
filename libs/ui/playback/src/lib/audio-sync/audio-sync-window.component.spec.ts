import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { ExternalAudioOverride } from '@iptvnator/shared/interfaces';
import type { ControlsSplitAudio } from '../player-controls/controls-split-audio';
import { AudioSyncController } from './audio-sync.controller';
import { AudioSyncWindowComponent } from './audio-sync-window.component';

describe('AudioSyncWindowComponent', () => {
    const audio = signal<ExternalAudioOverride | null>({
        streamUrl: 'http://audio/1',
        title: 'Alwan Sport',
        delaySeconds: 1,
    } as ExternalAudioOverride);
    const setDelay = jest.fn();
    const adjustDelay = jest.fn();
    let fixture: ComponentFixture<AudioSyncWindowComponent>;
    let sync: AudioSyncController;

    const root = () => fixture.nativeElement as HTMLElement;
    const byId = (id: string) =>
        root().querySelector(`[data-test-id="${id}"]`) as HTMLElement | null;
    const text = (id: string) => byId(id)?.textContent?.replace(/\s+/g, ' ').trim();

    function mount(): void {
        TestBed.configureTestingModule({
            imports: [AudioSyncWindowComponent, TranslateModule.forRoot()],
        });
        TestBed.runInInjectionContext(() => {
            sync = new AudioSyncController({
                api: () => undefined,
                audio,
                videoUrl: signal('http://video/1'),
                setDelay,
                clampDelay: (value) => value,
                toPlayback: (a) => ({ streamUrl: a.streamUrl, title: '', isLive: true }),
                ocr: { recognize: jest.fn(), dispose: jest.fn() },
                storage: null,
            });
        });
        sync.viewMode.set('live');
        const controls = {
            sync,
            activeAudio: audio,
            adjustDelay,
            saveDelay: jest.fn(),
            isDelaySaved: () => false,
        } as unknown as ControlsSplitAudio;
        fixture = TestBed.createComponent(AudioSyncWindowComponent);
        fixture.componentRef.setInput('controls', controls);
        fixture.detectChanges();
    }

    beforeEach(() => {
        localStorage.clear();
        setDelay.mockReset();
        adjustDelay.mockReset();
        audio.set({
            streamUrl: 'http://audio/1',
            title: 'Alwan Sport',
            delaySeconds: 1,
        } as ExternalAudioOverride);
    });

    it('shows both clocks, the difference, the delay and the suggestion', () => {
        mount();
        sync.main.set({ text: '87:43', confidence: 92, live: true, problem: null, manual: false });
        sync.audioReadout.set({ text: '87:47', confidence: 90, live: true, problem: null, manual: false });
        sync.offset.set(4);
        fixture.detectChanges();

        expect(text('audio-sync-main-clock')).toBe('87:43');
        expect(text('audio-sync-audio-clock')).toBe('87:47');
        expect(text('audio-sync-offset')).toContain('+4.0');
        expect(text('audio-sync-delay')).toContain('+1.0');
        expect(text('audio-sync-residual')).toContain('+3.0');
        expect(byId('audio-sync-verdict')).not.toBeNull();
    });

    it('applies the suggested delay and adjusts it in steps', () => {
        mount();
        sync.main.set({ text: '10:00', confidence: 90, live: true, problem: null, manual: false });
        sync.audioReadout.set({ text: '10:04', confidence: 90, live: true, problem: null, manual: false });
        sync.offset.set(4);
        fixture.detectChanges();

        byId('audio-sync-apply')?.click();
        expect(setDelay).toHaveBeenCalledWith(4);

        byId('audio-sync-delay-plus')?.click();
        expect(adjustDelay).toHaveBeenCalledWith(0.5);
        byId('audio-sync-delay-minus')?.click();
        expect(adjustDelay).toHaveBeenCalledWith(-0.5);
    });

    it('says so when in sync and offers no correction', () => {
        mount();
        sync.offset.set(1.2);
        fixture.detectChanges();

        expect(byId('audio-sync-apply')).toBeNull();
        expect(text('audio-sync-verdict')).toContain('CHANNELS.SPLIT_AUDIO.SYNC.IN_SYNC');
    });

    it('measures on demand in the measure view and shows the result', () => {
        mount();
        sync.viewMode.set('measure');
        sync.main.set({ text: '10:00', confidence: 90, live: true, problem: null, manual: false });
        fixture.detectChanges();

        expect(byId('audio-sync-measure')).not.toBeNull();
        expect(byId('audio-sync-view-measure')).not.toBeNull();
        expect(byId('audio-sync-view-live')).not.toBeNull();
        expect(byId('audio-sync-apply')).toBeNull();
    });

    it('explains a frozen source instead of showing an old picture as live', () => {
        mount();
        sync.audioReadout.set({ text: null, confidence: 0, live: false, problem: 'stale', manual: false });
        fixture.detectChanges();

        expect(text('audio-sync-audio-problem')).toContain('PROBLEM_STALE');
        expect(text('audio-sync-audio-clock')).toBe('--:--');
    });

    it('lets the user drag a clock area and confirms it', () => {
        mount();
        sync.mode.set('pick');
        fixture.detectChanges();
        const confirm = byId('audio-sync-confirm-region') as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);

        const stage = root().querySelector('.sync__shot--picking') as HTMLElement;
        stage.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
        stage.setPointerCapture = jest.fn();
        const fire = (type: string, x: number, y: number) =>
            stage.dispatchEvent(
                new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
            );
        fire('pointerdown', 20, 10);
        fire('pointermove', 100, 40);
        fire('pointerup', 100, 40);
        fixture.detectChanges();

        expect(confirm.disabled).toBe(false);
        const confirmRegion = jest.spyOn(sync, 'confirmRegion');
        confirm.click();
        expect(confirmRegion).toHaveBeenCalledWith({
            x: 0.1,
            y: 0.1,
            width: 0.4,
            height: expect.closeTo(0.3),
        });
    });

    it('closes from the close button and on Escape', () => {
        mount();
        const close = jest.spyOn(sync, 'close');

        byId('audio-sync-close')?.click();
        root().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(close).toHaveBeenCalledTimes(2);
    });
});
