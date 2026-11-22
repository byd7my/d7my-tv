import {
    effect,
    inject,
    Injectable,
    Injector,
    signal,
    untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    PlaylistsService,
    SplitAudioService,
    type SplitAudioSourceOption,
} from '@iptvnator/services';
import type { Channel, Playlist } from '@iptvnator/shared/interfaces';
import { XtreamApiService, type XtreamCredentials } from './xtream-api.service';
import { XtreamUrlService } from './xtream-url.service';

/** A loaded channel list is reused this long before it is fetched again. */
export const SPLIT_AUDIO_SOURCE_TTL_MS = 30 * 60 * 1000;
/** The saved-subscription list is re-read at most this often. */
const OPTIONS_TTL_MS = 60 * 1000;

/** A saved Xtream subscription (server, user and password), not a portal or M3U. */
export function isXtreamSubscription(playlist: Playlist): boolean {
    return (
        !!playlist.serverUrl &&
        !!playlist.username &&
        !playlist.macAddress &&
        !playlist.portalUrl
    );
}

/**
 * The channel list the "sound from" picker uses when the sound comes from a
 * second saved subscription. Each subscription has its own connection limit,
 * so a one-connection plan for the picture and another for the sound needs no
 * more than the two connections the user already pays for.
 *
 * Nothing is fetched until a subscription is chosen; the list is kept for
 * {@link SPLIT_AUDIO_SOURCE_TTL_MS} and fetched through the same Xtream API
 * the Live TV view uses.
 */
@Injectable({ providedIn: 'root' })
export class SplitAudioSourceService {
    private readonly splitAudio = inject(SplitAudioService);
    private readonly injector = inject(Injector);
    private readonly cache = new Map<
        string,
        { at: number; channels: readonly Channel[] }
    >();
    private optionsAt = 0;

    // Resolved on first use, not with the service: the Live TV view creates
    // this service for every channel, and most never open the sound picker.
    private get playlists(): PlaylistsService {
        return this.injector.get(PlaylistsService);
    }
    private get api(): XtreamApiService {
        return this.injector.get(XtreamApiService);
    }
    private get urls(): XtreamUrlService {
        return this.injector.get(XtreamUrlService);
    }

    /** The chosen subscription's channels; empty until it has loaded. */
    readonly channels = signal<readonly Channel[]>([]);
    /** Saved subscriptions the sound can come from. */
    readonly options = signal<readonly SplitAudioSourceOption[]>([]);

    constructor() {
        effect(() => {
            const id = this.splitAudio.audioSourceId();
            // A new channel is a moment to look again (cheap when cached).
            this.splitAudio.context();
            untracked(() => {
                void this.refreshOptions();
                void this.ensureLoaded(id);
            });
        });
    }

    async refreshOptions(force = false): Promise<void> {
        const now = Date.now();
        if (!force && now - this.optionsAt < OPTIONS_TTL_MS) return;
        this.optionsAt = now;
        try {
            const all = await firstValueFrom(this.playlists.getAllPlaylists());
            this.options.set(
                all.filter(isXtreamSubscription).map((playlist) => ({
                    id: playlist._id,
                    title: playlist.title,
                }))
            );
        } catch {
            // The picker still works with the picture's own subscription.
            this.options.set([]);
        }
    }

    async ensureLoaded(id: string | null): Promise<void> {
        if (!id) {
            this.channels.set([]);
            this.splitAudio.audioSourceStatus.set('idle');
            return;
        }
        const cached = this.cache.get(id);
        if (cached && Date.now() - cached.at < SPLIT_AUDIO_SOURCE_TTL_MS) {
            this.channels.set(cached.channels);
            this.splitAudio.audioSourceStatus.set('ready');
            return;
        }
        this.splitAudio.audioSourceStatus.set('loading');
        try {
            const channels = await this.fetchChannels(id);
            // The user may have chosen another subscription meanwhile.
            if (this.splitAudio.audioSourceId() !== id) return;
            this.cache.set(id, { at: Date.now(), channels });
            this.channels.set(channels);
            this.splitAudio.audioSourceStatus.set('ready');
        } catch (error) {
            if (this.splitAudio.audioSourceId() !== id) return;
            console.warn('Could not load the sound subscription', error);
            this.channels.set([]);
            this.splitAudio.audioSourceStatus.set('error');
        }
    }

    private async fetchChannels(id: string): Promise<readonly Channel[]> {
        const playlist = await firstValueFrom(
            this.playlists.getPlaylistById(id)
        );
        if (!playlist || !isXtreamSubscription(playlist)) {
            throw new Error('Not an Xtream subscription');
        }
        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl as string,
            username: playlist.username as string,
            password: playlist.password ?? '',
            userAgent: playlist.userAgent?.trim() || undefined,
        };
        // The formats the panel allows decide the stream address (the Live TV
        // view does the same); a panel that does not answer keeps the default.
        try {
            const info = await this.api.getAccountInfo(credentials);
            const formats = (info?.user_info?.allowed_output_formats ?? [])
                .map((format) => format.trim())
                .filter(Boolean);
            if (formats.length > 0) credentials.allowedOutputFormats = formats;
        } catch {
            // The channel list below reports a panel that is really down.
        }
        const streams = await this.api.getLiveStreams(credentials);
        const http = {
            'user-agent': playlist.userAgent ?? '',
            referrer: playlist.referrer ?? '',
            origin: playlist.origin ?? '',
        };
        return streams.map(
            (stream) =>
                ({
                    id: String(stream.stream_id),
                    name: stream.name ?? '',
                    url: this.urls.constructLiveUrl(
                        credentials,
                        stream.stream_id
                    ),
                    http,
                }) as Channel
        );
    }
}
