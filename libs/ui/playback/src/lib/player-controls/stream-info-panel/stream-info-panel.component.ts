import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { StreamStatsView } from '../stream-stats-view';

/**
 * The stream-info popover: how the stream is doing, then what was measured,
 * grouped into picture, sound and connection. Pure presentation — the rows come
 * from `buildStreamStatsView` and the sampling loop lives in
 * `ControlsStreamStats`. Opens under the corner button, so it positions itself
 * against the popover anchor that wraps it.
 */
@Component({
    selector: 'app-stream-info-panel',
    templateUrl: './stream-info-panel.component.html',
    styleUrl: './stream-info-panel.component.scss',
    imports: [TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamInfoPanelComponent {
    readonly view = input.required<StreamStatsView>();
    /** Plain-language explanation under each row. */
    readonly showHints = input(false);
    readonly hintsToggled = output<void>();

    readonly hasRows = computed(() => this.view().sections.length > 0);
}
