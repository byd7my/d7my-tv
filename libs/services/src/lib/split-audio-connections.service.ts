import { Injectable, inject } from '@angular/core';
import {
    extractXtreamAccountFromStreamUrl,
    XtreamConnectionLimits,
    XtreamStreamAccount,
} from '@iptvnator/shared/interfaces';
import { PortalStatusService } from './portal-status.service';

/** `short`: the subscription can never do it; `busy`: not right now. */
export type SplitConnectionsVerdict = 'ok' | 'busy' | 'short';

export interface SplitConnectionsReport {
    verdict: SplitConnectionsVerdict;
    /** Simultaneous connections the subscription allows. */
    max: number;
    /** Connections open on the server right now; null when it does not say. */
    active: number | null;
    /** Connections this subscription must carry for the split audio. */
    needed: number;
    /** Whether the picture and the sound come from this one subscription. */
    sharedByBoth: boolean;
}

/**
 * Two streams at once need two connections on one subscription (the picture
 * is already one of the open ones). `extra` is what the split adds.
 */
export function planSplitConnections(
    limits: XtreamConnectionLimits,
    needed: number,
    extra: number
): SplitConnectionsReport['verdict'] {
    if (limits.max < needed) return 'short';
    if (limits.active !== null && limits.active + extra > limits.max) {
        return 'busy';
    }
    return 'ok';
}

const SEVERITY: Record<SplitConnectionsVerdict, number> = {
    ok: 0,
    busy: 1,
    short: 2,
};

const sameAccount = (a: XtreamStreamAccount, b: XtreamStreamAccount) =>
    a.serverUrl.toLowerCase() === b.serverUrl.toLowerCase() &&
    a.username === b.username;

/**
 * Tells, from what each Xtream subscription reports about itself, whether the
 * split audio fits in its connection limit. Playlists that are not Xtream (or
 * panels that do not report a limit) give null: nothing is claimed about them.
 */
@Injectable({ providedIn: 'root' })
export class SplitAudioConnectionsService {
    private readonly portalStatus = inject(PortalStatusService);

    async inspect(
        videoUrl: string,
        audioUrl: string | null
    ): Promise<SplitConnectionsReport | null> {
        const video = extractXtreamAccountFromStreamUrl(videoUrl);
        const audio = audioUrl
            ? extractXtreamAccountFromStreamUrl(audioUrl)
            : null;
        const shared =
            !audioUrl || (!!video && !!audio && sameAccount(video, audio));
        const reports = (
            await Promise.all([
                video
                    ? this.report(video, shared ? 2 : 1, shared ? 1 : 0, shared)
                    : null,
                // A sound on another subscription needs one connection there.
                audio && video && !shared
                    ? this.report(audio, 1, 1, false)
                    : null,
            ])
        ).filter((report): report is SplitConnectionsReport => report !== null);
        return (
            reports.sort(
                (a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict]
            )[0] ?? null
        );
    }

    private async report(
        account: XtreamStreamAccount,
        needed: number,
        extra: number,
        sharedByBoth: boolean
    ): Promise<SplitConnectionsReport | null> {
        const details = await this.portalStatus.checkPortalStatusDetails(
            account.serverUrl,
            account.username,
            account.password
        );
        const limits = details.connections;
        if (!limits) return null;
        return {
            verdict: planSplitConnections(limits, needed, extra),
            max: limits.max,
            active: limits.active,
            needed,
            sharedByBoth,
        };
    }
}
