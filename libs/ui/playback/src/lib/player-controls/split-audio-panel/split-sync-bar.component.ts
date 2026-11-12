import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { ControlsSplitAudio } from '../controls-split-audio';

const IN_SYNC_BAND_SECONDS = 0.15;
/** The accuracy margin of "synced" (the clocks are read in whole seconds). */
const TOLERANCE_SECONDS = 0.5;

/**
 * A thin strip over the top of the video while sync runs: the mode, the state,
 * the difference and the two clocks. It is an overlay (the picture is not
 * resized or paused) and it never opens a session: the clocks are read from
 * frames the pair already has. The small canvas only gives the background
 * reader a place to paint the audio channel's clock while the big window is
 * closed.
 */
@Component({
    selector: 'app-split-sync-bar',
    templateUrl: './split-sync-bar.component.html',
    styleUrl: './split-sync-bar.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, TranslatePipe],
    host: {
        '(click)': '$event.stopPropagation()',
        '(dblclick)': '$event.stopPropagation()',
    },
})
export class SplitSyncBarComponent {
    readonly controls = input.required<ControlsSplitAudio>();

    protected readonly sync = computed(() => this.controls().syncCtl);
    protected readonly status = computed(() => this.sync().status());
    protected readonly isAuto = computed(() => this.sync().mode() === 'auto');

    /** The sound behind the picture (positive), seconds, from the backend's estimate. */
    protected readonly lateness = computed<number | null>(() => {
        const status = this.status();
        if (!status) return null;
        if (status.lateness !== null) return status.lateness;
        // Auto: between the run's own measurements the corrector holds none.
        const residual = status.sync?.residualSeconds ?? null;
        return residual === null ? null : residual + status.targetSeconds;
    });

    /** 'behind' / 'ahead' / 'inSync' for the difference line; null without a number. */
    protected readonly side = computed<'behind' | 'ahead' | 'inSync' | null>(
        () => {
            const status = this.status();
            const value = this.lateness();
            if (!status || value === null) return null;
            const off = value - status.targetSeconds;
            if (Math.abs(off) <= IN_SYNC_BAND_SECONDS) return 'inSync';
            return off > 0 ? 'behind' : 'ahead';
        }
    );

    protected readonly latenessLabel = computed(() => {
        const value = this.lateness();
        return value === null ? '' : Math.abs(value).toFixed(1);
    });

    /** The reading the two clocks show (auto only); null when there is none. */
    protected readonly pictureClock = computed(
        () => this.controls().sync.main().text
    );
    protected readonly audioClock = computed(
        () => this.controls().sync.audioReadout().text
    );

    /** State key for the label: the backend's state, or "waiting for a value" in manual. */
    protected readonly stateKey = computed(() => {
        const status = this.status();
        if (!status) return 'starting';
        if (
            !this.isAuto() &&
            status.lateness === null &&
            status.state !== 'paused' &&
            status.state !== 'off' &&
            status.state !== 'settling'
        ) {
            return 'needsValue';
        }
        return status.state;
    });

    /** The freeze that is about to start or running: what the countdown shows. */
    protected readonly freeze = computed(() => {
        const sync = this.status()?.sync;
        return sync &&
            (sync.phase === 'announcing' || sync.phase === 'freezing')
            ? sync
            : null;
    });

    /** How the run ended: "synced" with the margin, or "not synced" with what is left. */
    protected readonly outcome = computed<{
        text: string;
        params: Record<string, string>;
        failed: boolean;
    } | null>(() => {
        const sync = this.status()?.sync;
        if (!sync || !this.isAuto()) return null;
        const left = Math.abs(sync.residualSeconds ?? 0).toFixed(1);
        if (sync.phase === 'done') {
            return {
                text: 'CHANNELS.SPLIT_AUDIO.SYNC_BAR.DONE',
                params: { seconds: String(TOLERANCE_SECONDS) },
                failed: false,
            };
        }
        if (sync.phase !== 'failed') return null;
        return {
            text: `CHANNELS.SPLIT_AUDIO.SYNC_BAR.FAILED.${sync.failure ?? 'timeout'}`,
            params: { seconds: left },
            failed: true,
        };
    });

    /** Why the freeze did not run its course (the run went on gradually). */
    protected readonly cutKey = computed(() => {
        const cut = this.status()?.sync?.freezeCut;
        return cut && this.isAuto()
            ? `CHANNELS.SPLIT_AUDIO.SYNC_BAR.CUT.${cut}`
            : null;
    });

    /** Manual: a correction under way was cancelled and is not applied again by itself. */
    protected readonly voidedKey = computed(() => {
        const cause = this.status()?.manualVoided;
        return cause && !this.isAuto()
            ? `CHANNELS.SPLIT_AUDIO.SYNC_BAR.VOIDED.${cause}`
            : null;
    });

    protected readonly quickKey = computed<{
        key: string;
        params: Record<string, string>;
    } | null>(() => {
        const quick = this.status()?.quickSync;
        if (!quick) return null;
        const base = 'CHANNELS.SPLIT_AUDIO.SYNC_BAR.QUICK';
        if (quick.kind === 'jumped') {
            return {
                key: `${base}.${quick.side === 'picture' ? 'jumped_picture' : 'jumped_sound'}`,
                params: { seconds: quick.seconds.toFixed(1) },
            };
        }
        const params: Record<string, string> = {};
        return {
            key: `${base}.${quick.kind === 'nothing' ? 'nothing' : quick.why}`,
            params,
        };
    });

    /** Which side is ahead and by how much (display only, from the same estimate as the difference line). */
    protected readonly lead = computed<{
        side: 'picture' | 'audio';
        seconds: string;
    } | null>(() => {
        const side = this.side();
        if (!side || side === 'inSync') return null;
        // "Audio behind" means the picture is the side that is ahead.
        return {
            side: side === 'behind' ? 'picture' : 'audio',
            seconds: this.latenessLabel(),
        };
    });

    /** How far through the freeze the countdown is, 0 to 100 (display only). */
    protected readonly freezeProgress = computed(() => {
        const f = this.freeze();
        if (!f || f.phase !== 'freezing' || f.freezeSeconds <= 0) return 0;
        const done = (f.freezeSeconds - f.remainingSeconds) / f.freezeSeconds;
        return Math.round(Math.min(1, Math.max(0, done)) * 100);
    });

    /** Colour of the state dot: working, finished well, or not synced. */
    protected readonly tone = computed<'busy' | 'ok' | 'bad'>(() => {
        const phase = this.status()?.sync?.phase;
        if (this.isAuto() && phase === 'failed') return 'bad';
        if (this.isAuto() && phase === 'done') return 'ok';
        const state = this.status()?.state;
        if (state === 'failed') return 'bad';
        return state === 'synced' ? 'ok' : 'busy';
    });

    protected readonly correctionLabel = computed(() => {
        const status = this.status();
        if (!status?.correcting) return '';
        return `${(status.rate * 100).toFixed(1)}%`;
    });
}
