import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const IPTVNATOR_E2E_DATA_DIR_ENV = 'IPTVNATOR_E2E_DATA_DIR';

/**
 * Operator-selected data root for deployments that keep the database on a
 * mounted volume, for example `/data`. The E2E override wins.
 */
export const IPTVNATOR_DATA_DIR_ENV = 'IPTVNATOR_DATA_DIR';

function ensureDirectory(dirPath: string): string {
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }

    return dirPath;
}

const DATA_ROOT_DIRECTORY = '.d7my-tv';
/** The folder name used before the app was renamed to D7my-TV. */
const LEGACY_DATA_ROOT_DIRECTORY = '.iptvnator';

/**
 * The default data root, `~/.d7my-tv`. Data written under the former name
 * (`~/.iptvnator`) is copied across on first use. It is a copy, never a move:
 * the old folder stays untouched as a backup. The copy goes into a staging
 * folder that is renamed into place, so another thread never sees a half
 * copied database. If copying fails the old folder keeps being used, so no
 * data is ever hidden from the app.
 */
function resolveDefaultDataRoot(): string {
    const home = homedir();
    const target = join(home, DATA_ROOT_DIRECTORY);
    const legacy = join(home, LEGACY_DATA_ROOT_DIRECTORY);

    if (existsSync(target) || !existsSync(legacy)) {
        return ensureDirectory(target);
    }

    const staging = `${target}.migrating-${process.pid}-${Date.now()}`;
    try {
        cpSync(legacy, staging, { recursive: true });
        renameSync(staging, target);
    } catch {
        rmSync(staging, { recursive: true, force: true });
        // Another thread may have finished the same migration first.
        return existsSync(target) ? target : legacy;
    }
    return target;
}

export function getIptvnatorDataRoot(): string {
    const e2eDataDir = process.env[IPTVNATOR_E2E_DATA_DIR_ENV]?.trim();

    if (e2eDataDir) {
        return ensureDirectory(e2eDataDir);
    }

    const dataDir = process.env[IPTVNATOR_DATA_DIR_ENV]?.trim();

    if (dataDir) {
        return ensureDirectory(dataDir);
    }

    return resolveDefaultDataRoot();
}

export function getIptvnatorDatabaseDirectory(): string {
    const profile = process.env['IPTVNATOR_SOURCE_PROFILE'];
    if (profile && /^[a-f0-9]{64}$/.test(profile)) {
        return ensureDirectory(join(getIptvnatorDataRoot(), 'server-profiles', profile, 'databases'));
    }
    return ensureDirectory(join(getIptvnatorDataRoot(), 'databases'));
}

export function getIptvnatorDatabasePath(): string {
    return join(getIptvnatorDatabaseDirectory(), 'iptvnator.db');
}

export function getElectronUserDataPath(): string | null {
    const e2eDataDir = process.env[IPTVNATOR_E2E_DATA_DIR_ENV]?.trim();

    if (!e2eDataDir) {
        return null;
    }

    return ensureDirectory(join(e2eDataDir, 'user-data'));
}

export function getElectronConfigDirectory(): string | null {
    const e2eDataDir = process.env[IPTVNATOR_E2E_DATA_DIR_ENV]?.trim();

    if (!e2eDataDir) {
        return null;
    }

    return ensureDirectory(join(e2eDataDir, 'config'));
}
