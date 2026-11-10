import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    OnDestroy,
    OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type {
    EmbeddedMpvFrameCapture,
    EmbeddedMpvFrameRegion,
} from '@iptvnator/shared/interfaces';
import type { ControlsSplitAudio } from '../player-controls/controls-split-audio';
import { regionFromDrag } from './audio-sync-regions';
import type { SourceProblem, SyncSourceKey } from './audio-sync.model';

const POSITION_KEY = 'iptvnator.audioSync.window.v1';
const DELAY_STEPS = [0.1, 0.5, 1, 5] as const;
/** Keep at least this much of the window inside the player. */
const VISIBLE_MARGIN = 48;

interface Point {
    x: number;
    y: number;
}

function loadPosition(): Point | null {
    try {
        const raw = localStorage.getItem(POSITION_KEY);
        const parsed = raw ? (JSON.parse(raw) as Point) : null;
        return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

function savePosition(position: Point): void {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
        // not remembered; the window opens at its default place next time
    }
}

/**
 * Small floating window over the picture for syncing the audio channel by
 * match clock. Plain DOM above the player, so opening, moving or closing it
 * never resizes, pauses or restarts the main video. It shows the scoreboard
 * clock of the picture and of the audio channel (live, cropped), the clock
 * each one reads, their difference, the delay in use and the suggestion.
 */
@Component({
    selector: 'app-audio-sync-window',
    templateUrl: './audio-sync-window.component.html',
    styleUrl: './audio-sync-window.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, NgTemplateOutlet, TranslatePipe],
    host: {
        '[style.left.px]': 'position()?.x ?? null',
        '[style.top.px]': 'position()?.y ?? null',
        '[class.audio-sync-window--placed]': 'position() !== null',
        '(keydown)': 'onKeydown($event)',
        '(click)': '$event.stopPropagation()',
        '(dblclick)': '$event.stopPropagation()',
        '(pointermove)': '$event.stopPropagation()',
    },
})
export class AudioSyncWindowComponent implements OnInit, OnDestroy {
    readonly controls = input.required<ControlsSplitAudio>();

    protected readonly steps = DELAY_STEPS;
    protected readonly step = signal<number>(0.5);
    protected readonly position = signal<Point | null>(loadPosition());
    protected readonly selection = signal<EmbeddedMpvFrameRegion | null>(null);
    protected readonly editing = signal<SyncSourceKey | null>(null);
    protected readonly manualInvalid = signal(false);

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly mainCanvas =
        viewChild<ElementRef<HTMLCanvasElement>>('mainCanvas');
    private drag: { pointerId: number; dx: number; dy: number } | null = null;
    private selecting: { pointerId: number; start: Point } | null = null;

    protected readonly sync = computed(() => this.controls().sync);
    protected readonly isPicking = computed(() => this.sync().mode() === 'pick');
    protected readonly pickSource = computed(() => this.sync().pickSource());
    protected readonly showMain = computed(
        () => !this.isPicking() || this.pickSource() === 'main'
    );
    protected readonly showAudio = computed(
        () => !this.isPicking() || this.pickSource() === 'audio'
    );
    protected readonly audioName = computed(
        () => this.controls().activeAudio()?.title ?? ''
    );
    protected readonly delay = computed(() => this.sync().delay());
    protected readonly delayLabel = computed(() => this.signed(this.delay()));
    protected readonly offsetLabel = computed(() => {
        const offset = this.sync().offset();
        return offset === null ? null : this.signed(offset);
    });
    protected readonly residualLabel = computed(() => {
        const residual = this.sync().residual();
        return residual === null ? null : this.signed(residual);
    });
    protected readonly suggestion = computed(() => this.sync().suggestion());
    protected readonly suggestionSeconds = computed(() =>
        (this.suggestion()?.seconds ?? 0).toFixed(1)
    );
    protected readonly targetLabel = computed(() =>
        (this.suggestion()?.targetDelay ?? 0).toFixed(1)
    );
    protected readonly selectionBox = computed(() => {
        const region = this.selection();
        if (!region) return null;
        return {
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`,
        };
    });
    /** The picture is still opening; nothing to read yet. */
    protected readonly starting = computed(
        () => this.sync().previewStatus() === 'starting'
    );

    constructor() {
        // The picker opens on the region already saved, so confirming it
        // (or just moving on) is one tap.
        effect(() => {
            if (this.isPicking()) this.seed(this.pickSource());
        });
    }

    ngOnInit(): void {
        const sync = this.controls().sync;
        sync.mainFrameListener = (frame) => this.drawMain(frame);
        sync.pickFrameListener = (frame) => this.drawMain(frame);
    }

    ngOnDestroy(): void {
        const sync = this.controls().sync;
        sync.mainFrameListener = null;
        sync.pickFrameListener = null;
    }

    protected problemKey(problem: SourceProblem | null): string {
        switch (problem) {
            case 'unavailable':
                return 'CHANNELS.SPLIT_AUDIO.SYNC.PROBLEM_UNAVAILABLE';
            case 'stale':
                return 'CHANNELS.SPLIT_AUDIO.SYNC.PROBLEM_STALE';
            case 'noClock':
                return 'CHANNELS.SPLIT_AUDIO.SYNC.PROBLEM_NO_CLOCK';
            case 'failed':
                return 'CHANNELS.SPLIT_AUDIO.SYNC.PROBLEM_FAILED';
            default:
                return 'CHANNELS.SPLIT_AUDIO.SYNC.PROBLEM_NO_FRAME';
        }
    }

    protected confidenceClass(confidence: number): string {
        return confidence >= 80 ? 'high' : confidence >= 60 ? 'medium' : 'low';
    }

    protected seed(source: SyncSourceKey): void {
        const region =
            source === 'main'
                ? this.sync().mainRegion()
                : this.sync().audioRegion();
        this.selection.set(region);
    }

    protected selectPickSource(source: SyncSourceKey): void {
        this.sync().selectPickSource(source);
        this.seed(source);
    }

    protected confirmSelection(): void {
        const region = this.selection();
        if (!region) return;
        this.sync().confirmRegion(region);
        this.seed(this.sync().pickSource());
    }

    protected backToLive(): void {
        // Only possible once both regions are known.
        if (!this.sync().hasRegions()) return;
        this.sync().confirmRegion(
            (this.pickSource() === 'main'
                ? this.sync().mainRegion()
                : this.sync().audioRegion()) as EmbeddedMpvFrameRegion
        );
    }

    protected startEdit(source: SyncSourceKey): void {
        this.manualInvalid.set(false);
        this.editing.set(source);
    }

    protected submitManual(source: SyncSourceKey, input: HTMLInputElement): void {
        if (this.sync().setManualClock(source, input.value)) {
            this.editing.set(null);
            this.manualInvalid.set(false);
        } else {
            this.manualInvalid.set(true);
        }
    }

    protected close(): void {
        this.sync().close();
    }

    // --------------------------------------------------------------- drawing

    private drawMain(frame: EmbeddedMpvFrameCapture | null): void {
        const canvas = this.mainCanvas()?.nativeElement;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        if (!frame) {
            // No fresh picture: clear it rather than leave an old one that
            // would pass for live.
            context.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
            canvas.width = frame.width;
            canvas.height = frame.height;
        }
        context.putImageData(
            new ImageData(
                frame.data as Uint8ClampedArray<ArrayBuffer>,
                frame.width,
                frame.height
            ),
            0,
            0
        );
    }

    // ---------------------------------------------------------- region picker

    protected onStagePointerDown(event: PointerEvent): void {
        if (!this.isPicking() || event.button !== 0) return;
        const point = this.pointIn(event);
        if (!point) return;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.selecting = { pointerId: event.pointerId, start: point };
        this.selection.set(null);
        event.preventDefault();
    }

    protected onStagePointerMove(event: PointerEvent): void {
        if (!this.selecting || event.pointerId !== this.selecting.pointerId) {
            return;
        }
        const point = this.pointIn(event);
        if (!point) return;
        this.selection.set(regionFromDrag(this.selecting.start, point));
    }

    protected onStagePointerUp(event: PointerEvent): void {
        if (!this.selecting || event.pointerId !== this.selecting.pointerId) {
            return;
        }
        this.onStagePointerMove(event);
        this.selecting = null;
    }

    private pointIn(event: PointerEvent): Point | null {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        };
    }

    // ----------------------------------------------------------------- moving

    protected onDragStart(event: PointerEvent): void {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button')) return;
        const element = this.host.nativeElement;
        const parent = element.offsetParent as HTMLElement | null;
        if (!parent) return;
        const rect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        // Pin the current place first, so the first move does not jump.
        this.position.set({
            x: rect.left - parentRect.left,
            y: rect.top - parentRect.top,
        });
        this.drag = {
            pointerId: event.pointerId,
            dx: event.clientX - rect.left,
            dy: event.clientY - rect.top,
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    protected onDragMove(event: PointerEvent): void {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return;
        const element = this.host.nativeElement;
        const parent = element.offsetParent as HTMLElement | null;
        if (!parent) return;
        const parentRect = parent.getBoundingClientRect();
        const maxX = parent.clientWidth - VISIBLE_MARGIN;
        const maxY = parent.clientHeight - VISIBLE_MARGIN;
        const x = event.clientX - parentRect.left - this.drag.dx;
        const y = event.clientY - parentRect.top - this.drag.dy;
        this.position.set({
            x: Math.min(maxX, Math.max(VISIBLE_MARGIN - element.offsetWidth, x)),
            y: Math.min(maxY, Math.max(0, y)),
        });
    }

    protected onDragEnd(event: PointerEvent): void {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return;
        this.drag = null;
        const position = this.position();
        if (position) savePosition(position);
    }

    protected onKeydown(event: KeyboardEvent): void {
        // Typing a clock must never reach the player shortcuts.
        event.stopPropagation();
        if (event.key === 'Escape') this.close();
    }

    private signed(value: number): string {
        const rounded = Math.round(value * 10) / 10;
        return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
    }
}
