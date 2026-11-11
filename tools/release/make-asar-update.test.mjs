import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import {
    assetName,
    buildAsarUpdate,
    readAsarFile,
    readAsarVersion,
    readElectronVersion,
    readNativeInterface,
} from './make-asar-update.mjs';

const require = createRequire(import.meta.url);

describe('make-asar-update', () => {
    let directory;
    let asarPath;

    before(async () => {
        directory = mkdtempSync(join(tmpdir(), 'asar-update-'));
        const app = join(directory, 'app');
        mkdirSync(join(app, 'web'), { recursive: true });
        writeFileSync(join(app, 'package.json'), '{"name":"x","version":"1.2.3"}');
        writeFileSync(join(app, 'web', 'index.js'), 'console.log("hi")'.repeat(500));

        const resources = join(directory, 'win-unpacked', 'resources');
        mkdirSync(resources, { recursive: true });
        asarPath = join(resources, 'app.asar');
        await require('@electron/asar').createPackage(app, asarPath);
    });

    after(() => rmSync(directory, { recursive: true, force: true }));

    it('reads a file out of an asar without the asar package', () => {
        assert.equal(
            readAsarFile(asarPath, 'web/index.js').toString(),
            'console.log("hi")'.repeat(500)
        );
        assert.throws(() => readAsarFile(asarPath, 'missing.js'));
    });

    it('reads the app version from the asar', () => {
        assert.equal(readAsarVersion(asarPath), '1.2.3');
    });

    it('packs the asar and describes it in a manifest', async () => {
        const manifest = await buildAsarUpdate({
            executables: directory,
            electron: '43.8.4',
            nativeInterface: 7,
        });
        const original = readFileSync(asarPath);

        assert.deepEqual(manifest, {
            version: '1.2.3',
            electron: '43.8.4',
            nativeInterface: 7,
            asset: assetName('1.2.3'),
            sha256: createHash('sha256').update(original).digest('hex'),
            size: original.length,
        });
        assert.equal(assetName('1.2.3'), 'iptvnator-1.2.3-windows-x64-app.asar.br');
        assert.deepEqual(
            JSON.parse(readFileSync(join(directory, 'asar-update.json'), 'utf8')),
            manifest
        );
        assert.ok(
            brotliDecompressSync(
                readFileSync(join(directory, manifest.asset))
            ).equals(original)
        );
    });

    it('reads the native interface the app is built with', () => {
        assert.equal(
            readNativeInterface('export const ASAR_UPDATE_NATIVE_INTERFACE = 3;'),
            3
        );
        assert.throws(() => readNativeInterface('nothing here'));
        assert.equal(typeof readNativeInterface(), 'number');
    });

    it('reads the installed Electron version', () => {
        assert.match(readElectronVersion(), /^\d+\.\d+\.\d+/);
    });
});
