import {
    asarUpdateBlocker,
    parseAsarUpdateManifest,
} from './asar-update.model';

const VALID = {
    version: '1.2.3',
    electron: '43.8.4',
    nativeInterface: 1,
    asset: 'iptvnator-1.2.3-windows-x64-app.asar.br',
    sha256: 'a'.repeat(64),
    size: 1234,
};

describe('parseAsarUpdateManifest', () => {
    it('accepts a complete manifest', () => {
        expect(parseAsarUpdateManifest(VALID)).toEqual(VALID);
    });

    it.each([
        ['null', null],
        ['a string', 'manifest'],
        ['a missing version', { ...VALID, version: '' }],
        ['a short checksum', { ...VALID, sha256: 'abc' }],
        ['an uppercase checksum', { ...VALID, sha256: 'A'.repeat(64) }],
        ['a fractional interface', { ...VALID, nativeInterface: 1.5 }],
        ['a zero size', { ...VALID, size: 0 }],
        ['a path in the asset name', { ...VALID, asset: '../x.asar.br' }],
        ['a windows path in the asset name', { ...VALID, asset: 'a\\b.br' }],
    ])('rejects %s', (_name, value) => {
        expect(parseAsarUpdateManifest(value)).toBeNull();
    });

    it('drops fields it does not know', () => {
        expect(
            parseAsarUpdateManifest({ ...VALID, command: 'rm -rf /' })
        ).toEqual(VALID);
    });
});

describe('asarUpdateBlocker', () => {
    const runtime = { electron: '43.8.4', nativeInterface: 1 };

    it('lets a matching runtime through', () => {
        expect(asarUpdateBlocker(VALID, runtime)).toBeNull();
    });

    it('asks for the full version when Electron differs', () => {
        expect(
            asarUpdateBlocker({ ...VALID, electron: '44.0.0' }, runtime)
        ).toContain('Electron 44.0.0');
    });

    it('asks for the full version when the native layer differs', () => {
        expect(
            asarUpdateBlocker({ ...VALID, nativeInterface: 2 }, runtime)
        ).toContain('native layer');
    });
});
