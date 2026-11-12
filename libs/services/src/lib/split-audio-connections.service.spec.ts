import { TestBed } from '@angular/core/testing';
import type { XtreamConnectionLimits } from '@iptvnator/shared/interfaces';
import { PortalStatusService } from './portal-status.service';
import {
    planSplitConnections,
    SplitAudioConnectionsService,
} from './split-audio-connections.service';

const PICTURE = 'http://one.example:8080/live/alice/secret/10.ts';
const SAME_ACCOUNT = 'http://one.example:8080/live/alice/secret/11.ts';
const OTHER_ACCOUNT = 'http://two.example/live/bob/pw/5.ts';
const PLAIN_M3U = 'http://cdn.example/news/live.m3u8';

describe('planSplitConnections', () => {
    it.each<[XtreamConnectionLimits, number, number, string]>([
        [{ max: 1, active: 0 }, 2, 1, 'short'],
        [{ max: 2, active: 2 }, 2, 1, 'busy'],
        [{ max: 2, active: 1 }, 2, 1, 'ok'],
        [{ max: 2, active: null }, 2, 1, 'ok'],
        [{ max: 3, active: 3 }, 2, 1, 'busy'],
    ])('%j needing %d (+%d) is %s', (limits, needed, extra, verdict) => {
        expect(planSplitConnections(limits, needed, extra)).toBe(verdict);
    });
});

describe('SplitAudioConnectionsService', () => {
    const limitsByHost: Record<string, XtreamConnectionLimits | undefined> = {};
    const check = jest.fn(async (serverUrl: string) => ({
        status: 'active' as const,
        expiresAtSeconds: null,
        ...(limitsByHost[serverUrl]
            ? { connections: limitsByHost[serverUrl] }
            : {}),
    }));
    let service: SplitAudioConnectionsService;

    beforeEach(() => {
        check.mockClear();
        for (const key of Object.keys(limitsByHost)) delete limitsByHost[key];
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: PortalStatusService,
                    useValue: { checkPortalStatusDetails: check },
                },
            ],
        });
        service = TestBed.inject(SplitAudioConnectionsService);
    });

    it('asks for two connections when both streams share one subscription', async () => {
        limitsByHost['http://one.example:8080'] = { max: 1, active: 1 };

        await expect(service.inspect(PICTURE, SAME_ACCOUNT)).resolves.toEqual({
            verdict: 'short',
            max: 1,
            active: 1,
            needed: 2,
            sharedByBoth: true,
        });
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('also counts the split before a sound is picked', async () => {
        limitsByHost['http://one.example:8080'] = { max: 2, active: 1 };

        await expect(service.inspect(PICTURE, null)).resolves.toMatchObject({
            verdict: 'ok',
            needed: 2,
            sharedByBoth: true,
        });
    });

    it('checks each subscription when the sound comes from another one', async () => {
        limitsByHost['http://one.example:8080'] = { max: 1, active: 1 };
        limitsByHost['http://two.example'] = { max: 1, active: 1 };

        // The picture alone fits its own limit; the second one is full.
        await expect(
            service.inspect(PICTURE, OTHER_ACCOUNT)
        ).resolves.toMatchObject({
            verdict: 'busy',
            max: 1,
            needed: 1,
            sharedByBoth: false,
        });
        expect(check).toHaveBeenCalledTimes(2);
    });

    it('says nothing when the panel reports no limit', async () => {
        await expect(
            service.inspect(PICTURE, SAME_ACCOUNT)
        ).resolves.toBeNull();
    });

    it('says nothing for a playlist that is not an Xtream account', async () => {
        await expect(service.inspect(PLAIN_M3U, null)).resolves.toBeNull();
        expect(check).not.toHaveBeenCalled();
    });
});
