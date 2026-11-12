import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { ControlsSplitAudio } from '../controls-split-audio';
import { MANUAL_STEPS } from '../controls-split-sync';

/**
 * The sync part of the audio panel for the two-session mode: Auto or Manual,
 * the start button, the typed offset with the side that is ahead, and the
 * fine delay (the target the correction aims at, never a speed).
 */
@Component({
    selector: 'app-split-sync-section',
    templateUrl: './split-sync-section.component.html',
    styleUrl: './split-sync-section.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, TranslatePipe],
})
export class SplitSyncSectionComponent {
    readonly controls = input.required<ControlsSplitAudio>();
    protected readonly steps = MANUAL_STEPS;

    protected onOriginalAudio(event: Event): void {
        this.controls().syncCtl.setOriginalAudio(
            (event.target as HTMLInputElement).checked
        );
    }

    protected onSeconds(event: Event): void {
        const input = event.target as HTMLInputElement;
        const value = Number.parseFloat(input.value.replace(',', '.'));
        if (Number.isFinite(value)) {
            this.controls().syncCtl.setManualSeconds(value);
        }
        input.value = String(this.controls().syncCtl.manualSeconds());
    }
}
