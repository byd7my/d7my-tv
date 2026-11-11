import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress } from 'node:zlib';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/** The slice of a fetch response the download reads. */
export interface AsarDownloadResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: { get(name: string): string | null };
    body: unknown;
    json(): Promise<unknown>;
}

export type AsarFetcher = (
    url: string,
    init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<AsarDownloadResponse>;

export interface AsarDownloadOptions {
    url: string;
    destination: string;
    /** SHA-256 (hex) the decompressed file must have. */
    sha256: string;
    /** Size the decompressed file must have. */
    size: number;
    fetcher: AsarFetcher;
    signal?: AbortSignal;
    onProgress?: (transferred: number, total: number) => void;
}

/**
 * Downloads a brotli-compressed asar, decompresses it on the fly and keeps it
 * only when size and SHA-256 match the manifest. The file appears at
 * `destination` in one rename, so a half-written or tampered download is
 * never mistaken for a finished one.
 */
export async function downloadAsar(
    options: AsarDownloadOptions
): Promise<void> {
    const response = await options.fetcher(options.url, {
        headers: { 'User-Agent': 'iptvnator-asar-update' },
        signal: options.signal,
    });

    if (!response.ok || !response.body) {
        throw new Error(
            `Download failed: ${response.status} ${response.statusText}`.trim()
        );
    }

    const total = Number(response.headers.get('content-length')) || 0;
    const partial = `${options.destination}.part`;
    const hash = createHash('sha256');
    let transferred = 0;
    let decompressed = 0;

    const countDownload = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            transferred += chunk.length;
            options.onProgress?.(transferred, total);
            callback(null, chunk);
        },
    });
    const verify = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            decompressed += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
        },
    });

    try {
        await pipeline(
            Readable.fromWeb(response.body as WebReadableStream),
            countDownload,
            createBrotliDecompress(),
            verify,
            createWriteStream(partial)
        );

        if (decompressed !== options.size) {
            throw new Error(
                `Downloaded file has ${decompressed} bytes, expected ${options.size}.`
            );
        }

        if (hash.digest('hex') !== options.sha256) {
            throw new Error('Downloaded file does not match its checksum.');
        }

        await rename(partial, options.destination);
    } catch (error) {
        await rm(partial, { force: true });
        throw error;
    }
}
