import {
    forgetRegion,
    loadRegions,
    normalizeRegion,
    regionFromDrag,
    saveRegion,
} from './audio-sync-regions';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const data = new Map<string, string>();
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
    };
}

describe('audio sync regions', () => {
    it('turns a drag in any direction into a region', () => {
        expect(
            regionFromDrag({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.1 })
        ).toEqual({
            x: 0.2,
            y: 0.1,
            width: expect.closeTo(0.4),
            height: expect.closeTo(0.3),
        });
    });

    it('ignores a click or a sliver', () => {
        expect(regionFromDrag({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBeNull();
        expect(
            regionFromDrag({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.11 })
        ).toBeNull();
    });

    it('clamps a drag that leaves the picture', () => {
        const region = regionFromDrag({ x: -1, y: -1 }, { x: 2, y: 0.5 });

        expect(region).toEqual({ x: 0, y: 0, width: 1, height: 0.5 });
    });

    it('rejects bad numbers', () => {
        expect(
            normalizeRegion({ x: NaN, y: 0, width: 0.5, height: 0.5 })
        ).toBeNull();
    });

    it('remembers a region per channel and forgets it on request', () => {
        const storage = memoryStorage();
        const region = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 };

        saveRegion(storage, 'http://a/1', region);
        saveRegion(storage, 'http://a/2', { ...region, x: 0.5 });
        expect(loadRegions(storage)['http://a/1']).toEqual(region);

        forgetRegion(storage, 'http://a/1');
        expect(loadRegions(storage)['http://a/1']).toBeUndefined();
        expect(loadRegions(storage)['http://a/2']).toBeDefined();
    });

    it('survives corrupt storage', () => {
        const storage = memoryStorage();
        storage.setItem('iptvnator.audioSync.regions.v1', '{oops');

        expect(loadRegions(storage)).toEqual({});
    });

    it('keeps only the newest entries', () => {
        const storage = memoryStorage();
        for (let i = 0; i < 70; i++) {
            saveRegion(storage, `u${i}`, { x: 0, y: 0, width: 0.5, height: 0.5 });
        }
        const all = loadRegions(storage);

        expect(Object.keys(all)).toHaveLength(60);
        expect(all['u0']).toBeUndefined();
        expect(all['u69']).toBeDefined();
    });
});
