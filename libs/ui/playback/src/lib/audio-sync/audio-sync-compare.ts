import { computed, signal } from '@angular/core';
import { parseManualClock } from '../match-clock/match-clock.util';

/**
 * Compare view: the two clocks the user reads off the screen ("12:34") and
 * the difference between them (audio clock minus picture clock). Both are
 * read at the same moment, so typing them a few seconds apart changes nothing.
 */
export class AudioSyncCompare {
    readonly pictureText = signal('');
    readonly audioText = signal('');
    readonly offset = computed<number | null>(() => {
        const picture = parseManualClock(this.pictureText());
        const audio = parseManualClock(this.audioText());
        return picture === null || audio === null ? null : audio - picture;
    });

    clear(): void {
        this.pictureText.set('');
        this.audioText.set('');
    }
}
