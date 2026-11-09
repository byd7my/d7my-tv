import { usableSavedBounds } from './saved-window-bounds.util';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const external = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('usableSavedBounds', () => {
    it('keeps a position inside a connected display', () => {
        const saved = { x: 100, y: 80, width: 1280, height: 720 };
        expect(usableSavedBounds(saved, [primary])).toEqual(saved);
    });

    it('keeps a window that sits on a second connected display', () => {
        const saved = { x: 2200, y: 100, width: 1280, height: 720 };
        expect(usableSavedBounds(saved, [primary, external])).toEqual(saved);
    });

    it('drops a position saved on a display that is no longer connected', () => {
        const saved = { x: 2200, y: 100, width: 1280, height: 720 };
        expect(usableSavedBounds(saved, [primary])).toBeUndefined();
    });

    it('drops a window that only peeks in at the screen edge', () => {
        const saved = { x: 1900, y: 100, width: 1280, height: 720 };
        expect(usableSavedBounds(saved, [primary])).toBeUndefined();
    });

    it('drops missing or invalid saved bounds', () => {
        expect(usableSavedBounds(undefined, [primary])).toBeUndefined();
        expect(
            usableSavedBounds({ x: NaN, y: 0, width: 800, height: 600 }, [
                primary,
            ])
        ).toBeUndefined();
        expect(usableSavedBounds({ width: 800, height: 600 }, [primary])).toBeUndefined();
    });
});
