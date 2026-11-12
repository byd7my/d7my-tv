import { cpSync, existsSync, rmSync } from 'fs';
import { cp } from 'fs/promises';
import { basename, join, resolve } from 'path';

/** v0.19 packaged package.json used Nx's project name, electron-backend. */
export function selectLegacyProfile(
    appData: string,
    current: string
): string | null {
    const legacy = join(appData, 'electron-backend');
    if (resolve(legacy) === resolve(current)) return null;
    // Any current Chromium persistence is authoritative, including an empty
    // playlist store after a user deliberately deleted their sources.
    if (
        ['IndexedDB', 'Local Storage', 'Preferences', 'config.json'].some(
            (entry) => existsSync(join(current, entry))
        )
    )
        return null;
    return existsSync(join(legacy, 'IndexedDB', 'file__0.indexeddb.leveldb'))
        ? legacy
        : null;
}

/** Materialize symlink targets so Chromium cannot write through to the original. */
export async function copyLegacyIndexedDb(
    profile: string,
    snapshot: string
): Promise<void> {
    await cp(join(profile, 'IndexedDB'), join(snapshot, 'IndexedDB'), {
        recursive: true,
        dereference: true,
    });
}

const PERSISTENCE_ENTRIES = [
    'IndexedDB',
    'Local Storage',
    'Preferences',
    'config.json',
];

/** Folder names the profile had before the app was renamed to D7my-TV. */
const RENAMED_PROFILE_NAMES = ['iptvnator', 'IPTVnator'];

/** Chromium's per-process lock files must not follow a copied profile. */
const PROFILE_LOCK_FILES = new Set([
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'lockfile',
]);

/**
 * Copies the profile of the app's former name (`iptvnator`) into the current
 * one the first time the renamed app starts, so settings, sign-ins and the
 * Chromium storage carry over. A copy, never a move: the old folder is left
 * as a backup. Anything already stored in the current profile wins, and a
 * failed copy changes nothing (the staging folder is removed), so the app
 * simply starts like a fresh install and the next start tries again.
 */
export function migrateRenamedProfile(
    appData: string,
    current: string
): boolean {
    if (PERSISTENCE_ENTRIES.some((entry) => existsSync(join(current, entry)))) {
        return false;
    }
    const source = RENAMED_PROFILE_NAMES.map((name) => join(appData, name)).find(
        (candidate) =>
            resolve(candidate).toLowerCase() !==
                resolve(current).toLowerCase() &&
            PERSISTENCE_ENTRIES.some((entry) =>
                existsSync(join(candidate, entry))
            )
    );
    if (!source) return false;

    const staging = `${current}.migrating-${process.pid}`;
    try {
        cpSync(source, staging, {
            recursive: true,
            dereference: true,
            filter: (entry) => !PROFILE_LOCK_FILES.has(basename(entry)),
        });
        // The current folder may already hold start-up files (a compile
        // cache); merge the staged profile into it rather than replace it.
        cpSync(staging, current, { recursive: true, force: false });
        rmSync(staging, { recursive: true, force: true });
        return true;
    } catch {
        rmSync(staging, { recursive: true, force: true });
        return false;
    }
}
