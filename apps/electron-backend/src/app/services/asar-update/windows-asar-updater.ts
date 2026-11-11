import { app } from 'electron';
import { join } from 'node:path';
import type { AsarDownloadResponse } from './asar-update-download';
import { ASAR_UPDATE_NATIVE_INTERFACE } from './asar-update.model';
import { AsarUpdater } from './asar-updater';

/**
 * The Windows update source: code-only updates that replace `app.asar`.
 * Windows Smart App Control judges every new executable by its own hash, so
 * a full installer (new executables on every build) can be refused on a PC
 * where the previous one ran; the asar is plain data and never is.
 */
export function createWindowsAsarUpdater(): AsarUpdater {
    return new AsarUpdater({
        currentVersion: app.getVersion(),
        runtime: {
            electron: process.versions.electron,
            nativeInterface: ASAR_UPDATE_NATIVE_INTERFACE,
        },
        fetcher: (url, init) =>
            fetch(url, init) as unknown as Promise<AsarDownloadResponse>,
        asarPath: join(process.resourcesPath, 'app.asar'),
        executablePath: process.execPath,
        pid: process.pid,
        workDirectory: join(app.getPath('userData'), 'asar-updates'),
        quit: () => app.quit(),
    });
}
