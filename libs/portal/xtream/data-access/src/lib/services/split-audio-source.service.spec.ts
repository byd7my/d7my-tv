import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PlaylistsService, SplitAudioService } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    isXtreamSubscription,
    SplitAudioSourceService,
} from './split-audio-source.service';
import { XtreamApiService } from './xtream-api.service';
import { XtreamUrlService } from './xtream-url.service';

const playlist = (over: Partial<Playlist> = {}): Playlist =>
    ({
        _id: 'b',
        title: 'Second',
        serverUrl: 'http://panel.test:80',
        username: 'u',
        password: 'p',
        ...over,
    }) as Playlist;

describe('SplitAudioSourceService', () => {
    const getLiveStreams = jest.fn();
    const getAccountInfo = jest.fn();
    const getPlaylistById = jest.fn();
    const getAllPlaylists = jest.fn();
    let splitAudio: SplitAudioService;
    let service: SplitAudioSourceService;

    const settle = async () => {
        for (let i = 0; i < 6; i++) await Promise.resolve();
    };

    beforeEach(() => {
        localStorage.clear();
        getLiveStreams.mockReset();
        getAccountInfo.mockReset();
        getAccountInfo.mockResolvedValue({
            user_info: { allowed_output_formats: ['ts'] },
        });
        getPlaylistById.mockReset();
        getAllPlaylists.mockReset();
        getAllPlaylists.mockReturnValue(
            of([
                playlist(),
                playlist({
                    _id: 'm3u',
                    serverUrl: undefined,
                    username: undefined,
                }),
                playlist({
                    _id: 'st',
                    macAddress: 'AA:BB',
                    portalUrl: 'http://x',
                }),
            ])
        );
        getPlaylistById.mockReturnValue(of(playlist()));
        getLiveStreams.mockResolvedValue([
            { stream_id: 11, name: 'beIN Arabic 1' },
            { stream_id: 12, name: 'beIN Arabic 2' },
        ]);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists, getPlaylistById },
                },
                {
                    provide: XtreamApiService,
                    useValue: { getLiveStreams, getAccountInfo },
                },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructLiveUrl: (
                            c: { serverUrl: string; username: string },
                            id: number
                        ) => `${c.serverUrl}/live/${c.username}/x/${id}.ts`,
                    },
                },
            ],
        });
        splitAudio = TestBed.inject(SplitAudioService);
        service = TestBed.inject(SplitAudioSourceService);
    });

    it('only counts a saved Xtream subscription as a sound source', () => {
        expect(isXtreamSubscription(playlist())).toBe(true);
        expect(isXtreamSubscription(playlist({ serverUrl: undefined }))).toBe(
            false
        );
        expect(isXtreamSubscription(playlist({ macAddress: 'AA' }))).toBe(
            false
        );
    });

    it('lists the saved subscriptions, leaving out M3U and portals', async () => {
        await service.refreshOptions(true);
        expect(service.options()).toEqual([{ id: 'b', title: 'Second' }]);
    });

    it('loads nothing until a subscription is chosen', async () => {
        await service.ensureLoaded(null);
        expect(getLiveStreams).not.toHaveBeenCalled();
        expect(splitAudio.audioSourceStatus()).toBe('idle');
    });

    it('loads the chosen subscription with its own credentials', async () => {
        splitAudio.setAudioSource('b');
        await service.ensureLoaded('b');
        expect(getLiveStreams).toHaveBeenCalledWith(
            expect.objectContaining({
                serverUrl: 'http://panel.test:80',
                username: 'u',
                password: 'p',
            })
        );
        expect(service.channels().map((c) => c.name)).toEqual([
            'beIN Arabic 1',
            'beIN Arabic 2',
        ]);
        expect(service.channels()[0].url).toBe(
            'http://panel.test:80/live/u/x/11.ts'
        );
        expect(splitAudio.audioSourceStatus()).toBe('ready');
    });

    it('builds the stream addresses with the formats the panel allows', async () => {
        splitAudio.setAudioSource('b');
        await service.ensureLoaded('b');
        expect(getLiveStreams).toHaveBeenCalledWith(
            expect.objectContaining({ allowedOutputFormats: ['ts'] })
        );
    });

    it('still loads the channels when the panel does not answer account info', async () => {
        getAccountInfo.mockRejectedValue(new Error('timeout'));
        splitAudio.setAudioSource('b');
        await service.ensureLoaded('b');
        expect(service.channels()).toHaveLength(2);
        expect(getLiveStreams).toHaveBeenCalledWith(
            expect.not.objectContaining({
                allowedOutputFormats: expect.anything(),
            })
        );
    });

    it('reuses a fresh list instead of asking the panel again', async () => {
        splitAudio.setAudioSource('b');
        await service.ensureLoaded('b');
        await service.ensureLoaded('b');
        expect(getLiveStreams).toHaveBeenCalledTimes(1);
    });

    it('says so when the panel answers with an error', async () => {
        getLiveStreams.mockRejectedValue(new Error('403'));
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        splitAudio.setAudioSource('b');
        await service.ensureLoaded('b');
        expect(service.channels()).toEqual([]);
        expect(splitAudio.audioSourceStatus()).toBe('error');
        warn.mockRestore();
    });

    it('drops a list that arrives after another subscription was chosen', async () => {
        splitAudio.setAudioSource('c');
        await service.ensureLoaded('b');
        expect(service.channels()).toEqual([]);
        await settle();
    });
});
