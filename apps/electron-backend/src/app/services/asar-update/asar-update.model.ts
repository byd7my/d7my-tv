/**
 * Windows code-only update: the release carries `app.asar` (the application
 * code) as a separate asset, and the app swaps it in place instead of running
 * a new installer. The executables next to it stay byte-identical, so Windows
 * Smart App Control has nothing new to judge.
 */

/**
 * Bump when the JavaScript starts to need a different native layer than the
 * installed one (the embedded MPV addons, helper or libmpv): the code-only
 * update refuses to apply and the full installer is required instead.
 */
export const ASAR_UPDATE_NATIVE_INTERFACE = 1;

export const ASAR_UPDATE_MANIFEST_ASSET = 'asar-update.json';

export interface AsarUpdateManifest {
    /** App version carried by the asar (its package.json). */
    version: string;
    /** Electron the asar runs on; must match the installed runtime. */
    electron: string;
    nativeInterface: number;
    /** Release asset holding the brotli-compressed asar. */
    asset: string;
    /** SHA-256 (hex) of the decompressed asar. */
    sha256: string;
    /** Size in bytes of the decompressed asar. */
    size: number;
}

export interface AsarUpdateRuntime {
    electron: string;
    nativeInterface: number;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

/** Narrows untrusted JSON to a manifest; null when anything is off. */
export function parseAsarUpdateManifest(
    value: unknown
): AsarUpdateManifest | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const manifest = value as Record<string, unknown>;

    if (
        !isNonEmptyString(manifest['version']) ||
        !isNonEmptyString(manifest['electron']) ||
        !isNonEmptyString(manifest['asset']) ||
        !/^[0-9a-f]{64}$/.test(String(manifest['sha256'])) ||
        !Number.isInteger(manifest['nativeInterface']) ||
        !Number.isSafeInteger(manifest['size']) ||
        (manifest['size'] as number) <= 0 ||
        // The asset name is read from a file on the network: no paths.
        /[\\/]/.test(manifest['asset'])
    ) {
        return null;
    }

    return {
        version: manifest['version'],
        electron: manifest['electron'],
        nativeInterface: manifest['nativeInterface'] as number,
        asset: manifest['asset'],
        sha256: manifest['sha256'] as string,
        size: manifest['size'] as number,
    };
}

/** Why a manifest cannot be applied on this install; null when it can. */
export function asarUpdateBlocker(
    manifest: AsarUpdateManifest,
    runtime: AsarUpdateRuntime
): string | null {
    if (manifest.electron !== runtime.electron) {
        return `This version needs Electron ${manifest.electron} (installed: ${runtime.electron}). Install the full version from the releases page.`;
    }

    if (manifest.nativeInterface !== runtime.nativeInterface) {
        return 'This version needs a new native layer. Install the full version from the releases page.';
    }

    return null;
}
