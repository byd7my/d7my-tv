import { AudioSyncSlot } from './audio-sync-slot';

describe('AudioSyncSlot', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function create(settleMs = 1000) {
        const suspend = jest.fn();
        const resume = jest.fn();
        return { suspend, resume, slot: new AudioSyncSlot({ suspend, resume, settleMs: () => settleMs }) };
    }

    it('suspends once and is ready only after the settle time', async () => {
        const { slot, suspend } = create();
        let ready = false;

        slot.take();
        slot.take();
        void slot.ready().then(() => (ready = true));
        await jest.advanceTimersByTimeAsync(999);
        expect(ready).toBe(false);
        await jest.advanceTimersByTimeAsync(1);

        expect(suspend).toHaveBeenCalledTimes(1);
        expect(ready).toBe(true);
    });

    it('gives the sound back after the settle time, once', async () => {
        const { slot, resume } = create();
        slot.take();

        const given = slot.give();
        void slot.give();
        await jest.advanceTimersByTimeAsync(1000);
        await given;

        expect(resume).toHaveBeenCalledTimes(1);
        expect(slot.isTaken).toBe(false);
    });

    it('leaves the sound to a picture that took the slot again meanwhile', async () => {
        const { slot, resume, suspend } = create();
        slot.take();

        const given = slot.give();
        slot.take();
        await jest.advanceTimersByTimeAsync(1000);
        await given;

        expect(suspend).toHaveBeenCalledTimes(2);
        expect(resume).not.toHaveBeenCalled();
    });

    it('does nothing without a settle time', async () => {
        const { slot, resume } = create(0);
        slot.take();
        await slot.give();
        expect(resume).toHaveBeenCalledTimes(1);
    });
});
