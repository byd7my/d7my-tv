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
import type {
    Channel,
    EmbeddedMpvSplitAudioStatus,
} from '@iptvnator/shared/interfaces';
import { ControlsSplitAudio } from '../controls-split-audio';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
} from '../player-controls.model';
import { SplitSyncBarComponent } from './split-sync-bar.component';

const STATUS = {
    mode: 'dual-session',
    syncMode: 'auto',
    soundSessionId: 'sound-1',
    state: 'correcting',
    userSpeed: 1,
    mainSpeed: 0.97,
    soundSpeed: 1,
    correcting: 'main',
    rate: 0.03,
    lateness: 1.2,
    targetSeconds: 0.08,
    dBaseSeconds: 0.08,
    trimSeconds: 0,
    audioRate: null,
    issue: null,
} as EmbeddedMpvSplitAudioStatus;

describe('SplitSyncBarComponent', () => {
    const video = { id: 'v', name: 'V', url: 'http://h/v.ts' } as Channel;
    const audioChannel = {
        id: 'a',
        name: 'A',
        url: 'http://h/a.ts',
    } as Channel;
    let fixture: ComponentFixture<SplitSyncBarComponent>;
    let controls: ControlsSplitAudio;
    let state: WritableSignal<PlayerControlsState>;
    const root = () => fixture.nativeElement as HTMLElement;
    const text = (id: string) =>
        root().querySelector(`[data-test-id="${id}"]`)?.textContent?.trim();

    beforeEach(() => {
        localStorage.clear();
        TestBed.configureTestingModule({
            imports: [SplitSyncBarComponent, TranslateModule.forRoot()],
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
        const service = TestBed.inject(SplitAudioService);
        service.setContext({ video, channels: () => [video, audioChannel] });
        state = signal({
            isLive: true,
            splitAudioEnabled: true,
            splitAudio: STATUS,
        } as PlayerControlsState);
        controls = runInInjectionContext(
            TestBed.inject(Injector),
            () =>
                new ControlsSplitAudio(
                    state,
                    () =>
                        ({
                            setExternalAudio: jest.fn(),
                            setSplitAudioSyncMode: jest.fn(),
                        }) as unknown as PlayerControlsCommands
                )
        );
        controls.select(audioChannel);
        controls.syncCtl.setMode('manual');
        controls.syncCtl.start();
        fixture = TestBed.createComponent(SplitSyncBarComponent);
        fixture.componentRef.setInput('controls', controls);
        fixture.detectChanges();
    });

    it('shows the mode, the state and the difference without a session of its own', () => {
        expect(text('split-sync-bar-mode')).toContain('SYNC_MODE.MANUAL');
        expect(text('split-sync-bar-state')).toContain('correcting');
        expect(text('split-sync-bar-diff')).toContain('AUDIO_BEHIND');
        // manual: the clock readings are not shown at all
        expect(
            root().querySelector('[data-test-id="split-sync-bar-picture"]')
        ).toBeNull();
        expect(root().querySelector('canvas')).toBeNull();
    });

    it('asks for a value in manual when the backend has none', () => {
        state.update((value) => ({
            ...value,
            splitAudio: { ...STATUS, state: 'measuring', lateness: null },
        }));
        fixture.detectChanges();
        expect(text('split-sync-bar-state')).toContain('needsValue');
    });

    it('shows both clocks and a place for the background reader in auto', () => {
        controls.syncCtl.setMode('auto');
        fixture.detectChanges();
        expect(
            root().querySelector('[data-test-id="split-sync-bar-picture"]')
        ).not.toBeNull();
        expect(
            root().querySelector('[data-test-id="split-sync-bar-audio"]')
        ).not.toBeNull();
        expect(
            root().querySelector('canvas[data-embedded-mpv-preview]')
        ).not.toBeNull();
    });

    describe('Auto Sync run', () => {
        const run = (
            sync: Partial<NonNullable<EmbeddedMpvSplitAudioStatus['sync']>>,
            extra: Partial<EmbeddedMpvSplitAudioStatus> = {}
        ) => {
            controls.syncCtl.setMode('auto');
            state.update((value) => ({
                ...value,
                splitAudio: {
                    ...STATUS,
                    state: 'freezing',
                    correcting: null,
                    lateness: null,
                    sync: {
                        phase: 'idle',
                        side: null,
                        freezeSeconds: 0,
                        remainingSeconds: 0,
                        announceSeconds: 0,
                        capped: false,
                        freezeCut: null,
                        failure: null,
                        residualSeconds: null,
                        epoch: 0,
                        ...sync,
                    },
                    ...extra,
                },
            }));
            fixture.detectChanges();
        };

        it('warns before the picture freezes, with the length and the time left', () => {
            run({
                phase: 'announcing',
                side: 'picture',
                freezeSeconds: 12,
                announceSeconds: 2,
            });
            expect(text('split-sync-bar-freeze')).toContain('FREEZE_SOON');
            expect(
                root().querySelector('[data-test-id="split-sync-bar-count"]')
            ).toBeNull();
        });

        it('counts down while the picture is frozen, as an overlay strip (no resize)', () => {
            run({
                phase: 'freezing',
                side: 'picture',
                freezeSeconds: 12,
                remainingSeconds: 7.4,
            });
            expect(text('split-sync-bar-count')).toBe('7.4');
            expect(text('split-sync-bar-freeze')).toContain('PICTURE_FROZEN');
        });

        it('says when it is the sound that is frozen', () => {
            run({
                phase: 'freezing',
                side: 'sound',
                freezeSeconds: 6,
                remainingSeconds: 5,
            });
            expect(text('split-sync-bar-freeze')).toContain('SOUND_FROZEN');
        });

        it('shows "synced" with its margin once done, and offers Sync again', () => {
            run({ phase: 'done', residualSeconds: 0.1 }, { state: 'synced' });
            expect(text('split-sync-bar-outcome')).toContain('SYNC_BAR.DONE');
            expect(
                root().querySelector('[data-test-id="split-sync-bar-again"]')
            ).not.toBeNull();
            expect(
                root().querySelector('[data-test-id="split-sync-bar-freeze"]')
            ).toBeNull();
        });

        it('does not claim success when it failed: it shows why and what is left', () => {
            run(
                { phase: 'failed', failure: 'timeout', residualSeconds: 1.4 },
                { state: 'failed' }
            );
            const outcome = text('split-sync-bar-outcome') ?? '';
            expect(outcome).toContain('FAILED.timeout');
            expect(outcome).not.toContain('SYNC_BAR.DONE');
            expect(text('split-sync-bar-diff')).toContain('AUDIO_BEHIND');
            expect(
                root().querySelector('[data-test-id="split-sync-bar-again"]')
            ).not.toBeNull();
        });

        it('says why a freeze was skipped (cache) and that it corrects gradually', () => {
            run(
                { phase: 'fine', freezeCut: 'cache-insufficient' },
                { state: 'correcting' }
            );
            expect(text('split-sync-bar-cut')).toContain(
                'CUT.cache-insufficient'
            );
        });

        it('offers Cancel while the run works', () => {
            run({ phase: 'measuring' }, { state: 'measuring' });
            expect(
                root().querySelector('[data-test-id="split-sync-bar-cancel"]')
            ).not.toBeNull();
            expect(
                root().querySelector('[data-test-id="split-sync-bar-again"]')
            ).toBeNull();
        });

        it('shows the quick sync result for a moment', () => {
            run(
                { phase: 'done' },
                {
                    state: 'synced',
                    quickSync: {
                        kind: 'jumped',
                        side: 'picture',
                        seconds: 4.2,
                    },
                }
            );
            expect(text('split-sync-bar-quick')).toContain(
                'QUICK.jumped_picture'
            );
        });
    });

    it('manual: tells a cancelled correction was not applied again', () => {
        state.update((value) => ({
            ...value,
            splitAudio: { ...STATUS, manualVoided: 'pause' },
        }));
        fixture.detectChanges();
        expect(text('split-sync-bar-voided')).toContain('VOIDED.pause');
    });
});
