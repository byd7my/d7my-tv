import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, foldSearchText } from '@iptvnator/shared/interfaces';
import type { ControlsSplitAudio } from '../controls-split-audio';
import { SplitSyncSectionComponent } from './split-sync-section.component';

/** Search results beyond this are cut: refine the search instead of scrolling. */
const MAX_SEARCH_RESULTS = 40;
const DELAY_STEPS = [0.5, 1, 5, 10] as const;

/**
 * Floating "Audio" panel over the video: favorite audio channels first, a
 * search box for any other channel, the audio delay and the way back to the
 * channel's own audio. It is plain DOM (no dialog, no overlay), so opening it
 * never hides or pauses the picture.
 */
@Component({
    selector: 'app-split-audio-panel',
    templateUrl: './split-audio-panel.component.html',
    styleUrl: './split-audio-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, SplitSyncSectionComponent, TranslatePipe],
    host: {
        '(keydown)': 'onKeydown($event)',
        '(click)': '$event.stopPropagation()',
        '(dblclick)': '$event.stopPropagation()',
    },
})
export class SplitAudioPanelComponent {
    readonly controls = input.required<ControlsSplitAudio>();
    readonly closed = output<void>();

    protected readonly steps = DELAY_STEPS;
    protected readonly step = signal<number>(1);
    protected readonly searching = signal(false);
    protected readonly query = signal('');
    private readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');

    protected readonly active = computed(() => this.controls().activeAudio());

    /** Rows shown: search matches while typing, else the favorites. */
    protected readonly rows = computed<readonly Channel[]>(() => {
        const controls = this.controls();
        const videoUrl = controls.videoUrl();
        const channels = controls
            .channels()
            .filter((channel) => channel.url !== videoUrl);
        const needle = foldSearchText(this.query().trim());
        let rows: Channel[];
        if (needle) {
            rows = [];
            for (const channel of channels) {
                if (foldSearchText(channel.name ?? '').includes(needle)) {
                    rows.push(channel);
                    if (rows.length >= MAX_SEARCH_RESULTS) break;
                }
            }
            return rows;
        }
        rows = channels.filter((channel) => controls.isFavorite(channel));
        // The channel in use stays on top even when it is not a favorite.
        const activeUrl = this.active()?.streamUrl;
        if (activeUrl && !rows.some((row) => row.url === activeUrl)) {
            const current = channels.find((channel) => channel.url === activeUrl);
            if (current) rows.unshift(current);
        }
        return rows;
    });

    protected readonly isSearchMode = computed(
        () => this.query().trim().length > 0
    );

    protected readonly delayLabel = computed(() => {
        const delay = this.active()?.delaySeconds ?? 0;
        return `${delay > 0 ? '+' : ''}${delay}`;
    });

    protected toggleSearch(): void {
        const next = !this.searching();
        this.searching.set(next);
        if (next) {
            queueMicrotask(() => this.searchInput()?.nativeElement.focus());
        } else {
            this.query.set('');
        }
    }

    protected onQuery(event: Event): void {
        this.query.set((event.target as HTMLInputElement).value);
    }

    protected isActive(channel: Channel): boolean {
        return this.active()?.streamUrl === channel.url;
    }

    protected isFavorite(channel: Channel): boolean {
        return this.controls().isFavorite(channel);
    }

    protected onKeydown(event: KeyboardEvent): void {
        // Typing in the search box must never reach the player shortcuts.
        event.stopPropagation();
        if (event.key === 'Escape') {
            if (this.searching()) {
                this.toggleSearch();
            } else {
                this.closed.emit();
            }
        }
    }
}
