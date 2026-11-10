import type {
    EmbeddedMpvFrameRegion,
    EmbeddedMpvSession,
    ExternalAudioOverride,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    PICK_CAPTURE_WIDTH,
    PREVIEW_WIDTH,
    type SyncApi,
} from './audio-sync.model';

interface PreviewDeps {
    api: () => Partial<SyncApi> | undefined;
    audio: () => ExternalAudioOverride | null;
    toPlayback: (audio: ExternalAudioOverride) => ResolvedPortalPlayback;
    onPlaying: () => void;
    onFailed: () => void;
}

/**
 * The silent second session on the audio channel: starts it (cropped to the
 * scoreboard, or whole for the region picker), paints it onto the preview
 * canvas and disposes it. It never touches the main session.
 */
export class AudioSyncPreview {
    private id: string | null = null;
    private unsubscribe: (() => void) | null = null;
    /** Bumped by every (re)start and by `cancel`; stale async work checks it. */
    private epoch = 0;

    constructor(private readonly deps: PreviewDeps) {}

    /** Ignores any start still in flight. */
    cancel(): void {
        this.epoch++;
    }

    async start(region: EmbeddedMpvFrameRegion | null): Promise<void> {
        const epoch = ++this.epoch;
        await this.stop();
        const api = this.deps.api();
        const audio = this.deps.audio();
        if (!api || !audio || epoch !== this.epoch) return;

        try {
            const session = await api.createEmbeddedMpvPreviewSession?.({
                region: region ?? undefined,
                outputWidth: region ? PREVIEW_WIDTH : PICK_CAPTURE_WIDTH,
            });
            if (!session) throw new Error('no preview session');
            if (epoch !== this.epoch) {
                void api.disposeEmbeddedMpvSession?.(session.id);
                return;
            }
            this.id = session.id;
            this.unsubscribe =
                api.onEmbeddedMpvSessionUpdate?.((update) =>
                    this.onUpdate(update)
                ) ?? null;
            await api.attachEmbeddedMpvFrameView?.(session.id, 'preview');
            if (epoch !== this.epoch) return;
            await api.loadEmbeddedMpvPlayback?.(
                session.id,
                this.deps.toPlayback(audio)
            );
        } catch (error) {
            console.error('[audio-sync] preview failed to start:', error);
            if (epoch === this.epoch) this.deps.onFailed();
        }
    }

    async stop(): Promise<void> {
        const api = this.deps.api();
        const id = this.id;
        this.id = null;
        this.unsubscribe?.();
        this.unsubscribe = null;
        api?.detachEmbeddedMpvFrameView?.('preview');
        if (id) {
            try {
                await api?.disposeEmbeddedMpvSession?.(id);
            } catch {
                // the helper is gone already
            }
        }
    }

    private onUpdate(update: EmbeddedMpvSession): void {
        if (update.id !== this.id) return;
        if (update.status === 'error') this.deps.onFailed();
        else if (update.status === 'playing') this.deps.onPlaying();
    }
}
