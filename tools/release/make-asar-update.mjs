/**
 * Packs the Windows build's `app.asar` as a code-only update.
 *
 * Windows Smart App Control refuses executables it has no good verdict for,
 * and every full build produces new ones. The application code lives in
 * `app.asar`, which is plain data, so a release also carries it on its own
 * and the app swaps it in without running an installer (see
 * apps/electron-backend/src/app/services/asar-update).
 *
 * Reads `<executables>/win-unpacked/resources/app.asar` and writes, next to
 * the installer in `<executables>`:
 *   - iptvnator-<version>-windows-x64-app.asar.br   what the app downloads
 *   - asar-update.json                              what the app checks first
 *
 * The version comes from the package.json inside the asar, so the update
 * always reports what the app will report once it runs.
 */
import { createHash } from 'node:crypto';
import {
    closeSync,
    createReadStream,
    createWriteStream,
    openSync,
    readFileSync,
    readSync,
} from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { constants, createBrotliCompress } from 'node:zlib';
import { createRequire } from 'node:module';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootRequire = createRequire(join(repoRoot, 'package.json'));
const MODEL_FILE =
    'apps/electron-backend/src/app/services/asar-update/asar-update.model.ts';

export const MANIFEST_NAME = 'asar-update.json';

/** `ASAR_UPDATE_NATIVE_INTERFACE` as written in the app source. */
export function readNativeInterface(
    source = readFileSync(join(repoRoot, MODEL_FILE), 'utf8')
) {
    const match = source.match(
        /export const ASAR_UPDATE_NATIVE_INTERFACE\s*=\s*(\d+)\s*;/
    );

    if (!match) {
        throw new Error(`ASAR_UPDATE_NATIVE_INTERFACE not found in ${MODEL_FILE}`);
    }

    return Number(match[1]);
}

export function readElectronVersion() {
    return rootRequire('electron/package.json').version;
}

/** One file's bytes out of an asar, without the asar package (no install needed). */
export function readAsarFile(asarPath, innerPath) {
    const fd = openSync(asarPath, 'r');

    try {
        const prefix = Buffer.alloc(16);
        readSync(fd, prefix, 0, 16, 0);
        const headerSize = prefix.readUInt32LE(4);
        const jsonLength = prefix.readUInt32LE(12);
        const json = Buffer.alloc(jsonLength);
        readSync(fd, json, 0, jsonLength, 16);

        let node = JSON.parse(json.toString('utf8'));
        for (const part of innerPath.split('/')) {
            node = node?.files?.[part];
        }

        if (!node || node.unpacked || node.offset === undefined) {
            throw new Error(`${innerPath} is not stored in ${asarPath}`);
        }

        const data = Buffer.alloc(node.size);
        readSync(fd, data, 0, node.size, 8 + headerSize + Number(node.offset));
        return data;
    } finally {
        closeSync(fd);
    }
}

export function readAsarVersion(asarPath) {
    const packageJson = JSON.parse(
        readAsarFile(asarPath, 'package.json').toString('utf8')
    );

    if (typeof packageJson.version !== 'string' || !packageJson.version) {
        throw new Error(`No version in package.json inside ${asarPath}`);
    }

    return packageJson.version;
}

async function sha256Of(file) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
}

export function assetName(version) {
    return `iptvnator-${version}-windows-x64-app.asar.br`;
}

/**
 * @param {{
 *   executables: string,
 *   electron: string,
 *   nativeInterface: number,
 *   version?: string,
 *   quality?: number,
 * }} options
 */
export async function buildAsarUpdate(options) {
    const asarPath = join(
        options.executables,
        'win-unpacked',
        'resources',
        'app.asar'
    );
    const version = options.version ?? readAsarVersion(asarPath);
    const asset = assetName(version);
    const size = (await stat(asarPath)).size;
    const sha256 = await sha256Of(asarPath);

    await pipeline(
        createReadStream(asarPath),
        createBrotliCompress({
            params: {
                [constants.BROTLI_PARAM_QUALITY]: options.quality ?? 9,
                [constants.BROTLI_PARAM_LGWIN]: 24,
                [constants.BROTLI_PARAM_SIZE_HINT]: size,
            },
        }),
        createWriteStream(join(options.executables, asset))
    );

    const manifest = {
        version,
        electron: options.electron,
        nativeInterface: options.nativeInterface,
        asset,
        sha256,
        size,
    };

    await writeFile(
        join(options.executables, MANIFEST_NAME),
        `${JSON.stringify(manifest, null, 4)}\n`
    );

    return manifest;
}

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const executables = resolve(argumentValue('--executables') ?? 'dist/executables');
    const manifest = await buildAsarUpdate({
        executables,
        electron: argumentValue('--electron') ?? readElectronVersion(),
        nativeInterface: readNativeInterface(),
    });

    console.log(JSON.stringify(manifest, null, 2));
}
