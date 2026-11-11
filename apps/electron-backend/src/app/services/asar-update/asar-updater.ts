import { EventEmitter } from 'node:events';
import { access, constants, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { compareAppVersions } from '@iptvnator/shared/interfaces';
import type {
    AppUpdateFeedTarget,
    AppUpdateGitHubFeedOptions,
} from '../app-update-feed';
import type { AppUpdaterAdapter } from '../app-update.service';
import { normalizeVersion } from '../app-update-release-catalog';
import { launchAsarSwap, type AsarSwapRequest } from './asar-swap-script';
import {
    AsarFetcher,
    AsarDownloadOptions,
    downloadAsar,
} from './asar-update-download';
import {
    ASAR_UPDATE_MANIFEST_ASSET,
    AsarUpdateManifest,
    AsarUpdateRuntime,
    asarUpdateBlocker,
    parseAsarUpdateManifest,
} from './asar-update.model';

const RELEASES_PER_PAGE = 10;
const METADATA_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

interface GitHubAsset {
    name?: string;
    browser_download_url?: string;
}

interface GitHubRelease {
    draft?: boolean;
    prerelease?: boolean;
    name?: string | null;
    body?: string | null;
    published_at?: string | null;
    assets?: GitHubAsset[];
}

interface FoundUpdate {
    manifest: AsarUpdateManifest;
    release: GitHubRelease;
    assetUrl: string;
}

export interface AsarUpdaterOptions {
    currentVersion: string;
    runtime: AsarUpdateRuntime;
    fetcher: AsarFetcher;
    /** `<resources>/app.asar` of the running install. */
    asarPath: string;
    /** The app's own executable (also runs the swap in Node mode). */
    executablePath: string;
    pid: number;
    /** Where downloads and the swap script live (inside the user data). */
    workDirectory: string;
    quit: () => void;
    /** Test seams. */
    download?: (options: AsarDownloadOptions) => Promise<void>;
    launchSwap?: (request: AsarSwapRequest) => void;
}

/**
 * Update source for Windows installs: finds a release that carries a code-only
 * asar, downloads and verifies it, and swaps it in when the app quits. It
 * speaks the same events as electron-updater, so `AppUpdateService` and the
 * update UI do not know the difference.
 */
export class AsarUpdater
    extends EventEmitter
    implements AppUpdaterAdapter, AppUpdateFeedTarget
{
    autoDownload = false;
    autoInstallOnAppQuit = false;
    allowPrerelease = false;
    allowDowngrade = false;
    channel: string | null = 'latest';

    private feed: AppUpdateGitHubFeedOptions | null = null;
    private found: FoundUpdate | null = null;
    private downloaded: string | null = null;

    constructor(private readonly options: AsarUpdaterOptions) {
        super();
    }

    setFeedURL(options: AppUpdateGitHubFeedOptions): void {
        this.feed = options;
    }

    async checkForUpdates(): Promise<unknown> {
        this.emit('checking-for-update');

        try {
            const found = await this.findLatest();
            const current = normalizeVersion(this.options.currentVersion);

            this.found = null;

            if (!found || compareAppVersions(found.manifest.version, current) <= 0) {
                this.emit('update-not-available', {
                    version: found?.manifest.version ?? current,
                });
                return null;
            }

            const blocker = asarUpdateBlocker(found.manifest, this.options.runtime);

            if (blocker) {
                throw new Error(blocker);
            }

            this.found = found;
            this.emit('update-available', {
                version: found.manifest.version,
                releaseDate: found.release.published_at ?? undefined,
                releaseName: found.release.name ?? null,
                releaseNotes: found.release.body ?? null,
            });

            return found.manifest;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async downloadUpdate(): Promise<string[]> {
        const found = this.found;

        try {
            if (!found) {
                throw new Error('No update has been found to download.');
            }

            await access(dirname(this.options.asarPath), constants.W_OK).catch(
                () => {
                    throw new Error(
                        'The install folder is not writable. Install the full version from the releases page.'
                    );
                }
            );
            await mkdir(this.options.workDirectory, { recursive: true });
            await this.removeOldDownloads();

            const destination = join(
                this.options.workDirectory,
                `app-${found.manifest.version}.asar`
            );
            const started = Date.now();

            await (this.options.download ?? downloadAsar)({
                url: found.assetUrl,
                destination,
                sha256: found.manifest.sha256,
                size: found.manifest.size,
                fetcher: this.options.fetcher,
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
                onProgress: (transferred, total) => {
                    const seconds = Math.max((Date.now() - started) / 1000, 0.001);

                    this.emit('download-progress', {
                        transferred,
                        total,
                        percent: total > 0 ? (transferred / total) * 100 : 0,
                        bytesPerSecond: transferred / seconds,
                    });
                },
            });

            this.downloaded = destination;
            this.emit('update-downloaded', {
                version: found.manifest.version,
                releaseDate: found.release.published_at ?? undefined,
                releaseName: found.release.name ?? null,
                releaseNotes: found.release.body ?? null,
            });

            return [destination];
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    quitAndInstall(): void {
        if (!this.downloaded) {
            throw new Error('No downloaded update to install.');
        }

        (this.options.launchSwap ?? launchAsarSwap)({
            workDirectory: this.options.workDirectory,
            source: this.downloaded,
            target: this.options.asarPath,
            executable: this.options.executablePath,
            pid: this.options.pid,
        });
        this.options.quit();
    }

    private async removeOldDownloads(): Promise<void> {
        const names = await readdir(this.options.workDirectory).catch(() => []);

        await Promise.all(
            names
                .filter((name) => /^app-.*\.asar(\.part)?$/.test(name))
                .map((name) =>
                    rm(join(this.options.workDirectory, name), { force: true })
                )
        );
    }

    /** Newest release that carries a valid code-only update, if any. */
    private async findLatest(): Promise<FoundUpdate | null> {
        if (!this.feed) {
            throw new Error('The update source is not configured.');
        }

        const releases = await this.fetchJson(
            `https://api.github.com/repos/${this.feed.owner}/${this.feed.repo}/releases?per_page=${RELEASES_PER_PAGE}`
        );

        if (!Array.isArray(releases)) {
            throw new Error('Could not read the release list.');
        }

        for (const release of releases as GitHubRelease[]) {
            if (release.draft || (release.prerelease && !this.allowPrerelease)) {
                continue;
            }

            const assets = release.assets ?? [];
            const manifestUrl = assets.find(
                (asset) => asset.name === ASAR_UPDATE_MANIFEST_ASSET
            )?.browser_download_url;

            if (!manifestUrl) {
                continue;
            }

            const manifest = parseAsarUpdateManifest(
                await this.fetchJson(manifestUrl)
            );
            const assetUrl = assets.find(
                (asset) => asset.name === manifest?.asset
            )?.browser_download_url;

            if (manifest && assetUrl) {
                return { manifest, release, assetUrl };
            }
        }

        return null;
    }

    private async fetchJson(url: string): Promise<unknown> {
        const response = await this.options.fetcher(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'iptvnator-asar-update',
            },
            signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(
                `Update check failed: ${response.status} ${response.statusText}`.trim()
            );
        }

        return response.json();
    }
}
