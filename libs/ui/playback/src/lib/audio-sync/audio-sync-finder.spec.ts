import type { EmbeddedMpvFrameCapture } from '@iptvnator/shared/interfaces';
import { AudioSyncFinder } from './audio-sync-finder';

const frame = { width: 4, height: 4 } as EmbeddedMpvFrameCapture;
const region = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };

describe('AudioSyncFinder', () => {
    it('applies the area it found', async () => {
        const locate = jest.fn().mockResolvedValue(region);
        const finder = new AudioSyncFinder(locate);
        const apply = jest.fn();
        finder.see(frame);

        await finder.run(apply);

        expect(apply).toHaveBeenCalledWith(region);
        expect(finder.failed()).toBe(false);
        expect(finder.finding()).toBe(false);
    });

    it('says so when no clock is found', async () => {
        const finder = new AudioSyncFinder(jest.fn().mockResolvedValue(null));
        const apply = jest.fn();
        finder.see(frame);

        await finder.run(apply);

        expect(apply).not.toHaveBeenCalled();
        expect(finder.failed()).toBe(true);
    });

    it('does nothing without a picture', async () => {
        const locate = jest.fn();
        const finder = new AudioSyncFinder(locate);

        await finder.run(jest.fn());

        expect(locate).not.toHaveBeenCalled();
    });

    it('searches by itself once per pick, not again after going back', async () => {
        const locate = jest.fn().mockResolvedValue(region);
        const finder = new AudioSyncFinder(locate);
        finder.see(frame);

        finder.auto(jest.fn());
        await Promise.resolve();
        finder.auto(jest.fn());
        expect(locate).toHaveBeenCalledTimes(1);

        finder.reset();
        finder.skipAuto();
        finder.auto(jest.fn());
        expect(locate).toHaveBeenCalledTimes(1);

        finder.reset();
        finder.auto(jest.fn());
        expect(locate).toHaveBeenCalledTimes(2);
    });

    it('lets the person search again after a miss', async () => {
        const locate = jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(region);
        const finder = new AudioSyncFinder(locate);
        const apply = jest.fn();
        finder.see(frame);

        await finder.run(apply);
        await finder.run(apply);

        expect(apply).toHaveBeenCalledTimes(1);
        expect(finder.failed()).toBe(false);
    });
});
