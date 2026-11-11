import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AsarDownloadResponse, AsarFetcher } from './asar-update-download';
import { AsarUpdater, AsarUpdaterOptions } from './asar-updater';

const RUNTIME = { electron: '43.8.4', nativeInterface: 1 };
const MANIFEST_URL = 'https://dl.example.test/asar-update.json';
const ASSET_URL = 'https://dl.example.test/app.asar.br';

function manifest(overrides: Record<string, unknown> = {}) {
    return {
        version: '0.26.12',
        electron: '43.8.4',
        nativeInterface: 1,
        asset: 'iptvnator-0.26.12-windows-x64-app.asar.br',
        sha256: 'c'.repeat(64),
        size: 100,
        ...overrides,
    };
}

function release(overrides: Record<string, unknown> = {}) {
    return {
        name: 'Release v0.26.12',
        body: 'notes',
        published_at: '2026-11-11T00:00:00Z',
        assets: [
            { name: 'asar-update.json', browser_download_url: MANIFEST_URL },
            {
                name: 'iptvnator-0.26.12-windows-x64-app.asar.br',
                browser_download_url: ASSET_URL,
            },
        ],
        ...overrides,
    };
}

function json(value: unknown, ok = true): AsarDownloadResponse {
    return {
        ok,
        status: ok ? 200 : 500,
        statusText: ok ? 'OK' : 'Server Error',
        headers: { get: () => null },
        body: null,
        json: async () => value,
    };
}

describe('AsarUpdater', () => {
    let directory: string;
    let releases: unknown[];
    let manifests: Record<string, unknown>;
    let quit: jest.Mock;
    let launchSwap: jest.Mock;
    let download: jest.Mock;

    function create(overrides: Partial<AsarUpdaterOptions> = {}) {
        const fetcher: AsarFetcher = async (url) =>
            url.startsWith('https://api.github.com/')
                ? json(releases)
                : json(manifests[url] ?? {}, url in manifests);
        const updater = new AsarUpdater({
            currentVersion: '0.26.9',
            runtime: RUNTIME,
            fetcher,
            asarPath: join(directory, 'resources', 'app.asar'),
            executablePath: join(directory, 'IPTVnator.exe'),
            pid: 4242,
            workDirectory: join(directory, 'asar-updates'),
            quit,
            launchSwap,
            download,
            ...overrides,
        });
        updater.setFeedURL({ provider: 'github', owner: 'o', repo: 'r' });

        return updater;
    }

    function record(updater: AsarUpdater) {
        const events: Array<[string, unknown]> = [];
        for (const name of [
            'checking-for-update',
            'update-available',
            'update-not-available',
            'download-progress',
            'update-downloaded',
            'error',
        ]) {
            updater.on(name as 'error', (payload: unknown) =>
                events.push([name, payload])
            );
        }
        return events;
    }

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'asar-updater-'));
        // the install folder must exist and be writable
        mkdirSync(join(directory, 'resources'));
        releases = [release()];
        manifests = { [MANIFEST_URL]: manifest() };
        quit = jest.fn();
        launchSwap = jest.fn();
        download = jest.fn(async ({ onProgress }) => onProgress?.(50, 100));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it('offers a newer version that matches the installed runtime', async () => {
        const updater = create();
        const events = record(updater);

        await updater.checkForUpdates();

        expect(events.map(([name]) => name)).toEqual([
            'checking-for-update',
            'update-available',
        ]);
        expect(events[1][1]).toMatchObject({
            version: '0.26.12',
            releaseName: 'Release v0.26.12',
            releaseNotes: 'notes',
        });
    });

    it('reports no update when the installed version is current', async () => {
        const updater = create({ currentVersion: '0.26.12' });
        const events = record(updater);

        await updater.checkForUpdates();

        expect(events.map(([name]) => name)).toEqual([
            'checking-for-update',
            'update-not-available',
        ]);
    });

    it('reports no update when no release carries a manifest', async () => {
        releases = [release({ assets: [] })];
        const updater = create();
        const events = record(updater);

        await updater.checkForUpdates();

        expect(events.at(-1)?.[0]).toBe('update-not-available');
    });

    it('skips drafts, prereleases and releases without the asset', async () => {
        releases = [
            release({ draft: true }),
            release({ prerelease: true }),
            release({
                assets: [
                    { name: 'asar-update.json', browser_download_url: MANIFEST_URL },
                ],
            }),
        ];
        const updater = create();
        const events = record(updater);

        await updater.checkForUpdates();

        expect(events.at(-1)?.[0]).toBe('update-not-available');
    });

    it('refuses a version built for another Electron', async () => {
        manifests = { [MANIFEST_URL]: manifest({ electron: '44.0.0' }) };
        const updater = create();
        const events = record(updater);

        await expect(updater.checkForUpdates()).rejects.toThrow('44.0.0');

        expect(events.at(-1)?.[0]).toBe('error');
    });

    it('refuses a version that needs a new native layer', async () => {
        manifests = { [MANIFEST_URL]: manifest({ nativeInterface: 2 }) };

        await expect(create().checkForUpdates()).rejects.toThrow(
            'native layer'
        );
    });

    it('ignores a manifest that is not valid', async () => {
        manifests = { [MANIFEST_URL]: { version: '9.9.9' } };
        const updater = create();
        const events = record(updater);

        await updater.checkForUpdates();

        expect(events.at(-1)?.[0]).toBe('update-not-available');
    });

    it('reports a failing release list', async () => {
        const updater = create({
            fetcher: async () => json({}, false),
        });
        const events = record(updater);

        await expect(updater.checkForUpdates()).rejects.toThrow('500');

        expect(events.at(-1)?.[0]).toBe('error');
    });

    it('downloads the verified asar and reports progress', async () => {
        const updater = create();
        const events = record(updater);

        await updater.checkForUpdates();
        const files = await updater.downloadUpdate();

        expect(download).toHaveBeenCalledWith(
            expect.objectContaining({
                url: ASSET_URL,
                sha256: 'c'.repeat(64),
                size: 100,
            })
        );
        expect(files).toEqual([
            join(directory, 'asar-updates', 'app-0.26.12.asar'),
        ]);
        expect(events.map(([name]) => name)).toEqual([
            'checking-for-update',
            'update-available',
            'download-progress',
            'update-downloaded',
        ]);
        expect(events[2][1]).toMatchObject({ transferred: 50, total: 100 });
    });

    it('does not download before a check found an update', async () => {
        const updater = create();
        const events = record(updater);

        await expect(updater.downloadUpdate()).rejects.toThrow('No update');

        expect(download).not.toHaveBeenCalled();
        expect(events.at(-1)?.[0]).toBe('error');
    });

    it('refuses to download when the install folder cannot be written', async () => {
        const updater = create({
            asarPath: join(directory, 'no-such-folder', 'app.asar'),
        });

        await updater.checkForUpdates();

        await expect(updater.downloadUpdate()).rejects.toThrow('not writable');
        expect(download).not.toHaveBeenCalled();
    });

    it('swaps the file and quits only after a finished download', async () => {
        const updater = create();

        expect(() => updater.quitAndInstall()).toThrow('No downloaded update');
        expect(quit).not.toHaveBeenCalled();

        await updater.checkForUpdates();
        const [file] = await updater.downloadUpdate();
        updater.quitAndInstall();

        expect(launchSwap).toHaveBeenCalledWith({
            workDirectory: join(directory, 'asar-updates'),
            source: file,
            target: join(directory, 'resources', 'app.asar'),
            executable: join(directory, 'IPTVnator.exe'),
            pid: 4242,
        });
        expect(quit).toHaveBeenCalledTimes(1);
    });

    it('does not quit when the swap could not be started', async () => {
        launchSwap.mockImplementation(() => {
            throw new Error('spawn failed');
        });
        const updater = create();

        await updater.checkForUpdates();
        await updater.downloadUpdate();

        expect(() => updater.quitAndInstall()).toThrow('spawn failed');
        expect(quit).not.toHaveBeenCalled();
    });
});
