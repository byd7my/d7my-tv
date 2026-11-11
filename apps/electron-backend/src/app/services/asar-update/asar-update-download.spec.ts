import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import {
    AsarDownloadResponse,
    AsarFetcher,
    downloadAsar,
} from './asar-update-download';

const CONTENT = Buffer.from('pretend this is an asar archive '.repeat(5000));
const SHA = createHash('sha256').update(CONTENT).digest('hex');

function respond(body: Buffer, init: Partial<AsarDownloadResponse> = {}) {
    const fetcher: AsarFetcher = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => String(body.length) },
        body: new Response(new Uint8Array(body)).body,
        json: async () => ({}),
        ...init,
    });

    return fetcher;
}

describe('downloadAsar', () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'asar-download-'));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it('decompresses the download and keeps it when the checksum matches', async () => {
        const destination = join(directory, 'app.asar');
        const progress: number[] = [];

        await downloadAsar({
            url: 'https://example.test/app.asar.br',
            destination,
            sha256: SHA,
            size: CONTENT.length,
            fetcher: respond(brotliCompressSync(CONTENT)),
            onProgress: (transferred) => progress.push(transferred),
        });

        expect(readFileSync(destination).equals(CONTENT)).toBe(true);
        expect(readdirSync(directory)).toEqual(['app.asar']);
        expect(progress.length).toBeGreaterThan(0);
    });

    it('keeps nothing when the checksum differs', async () => {
        await expect(
            downloadAsar({
                url: 'https://example.test/app.asar.br',
                destination: join(directory, 'app.asar'),
                sha256: 'b'.repeat(64),
                size: CONTENT.length,
                fetcher: respond(brotliCompressSync(CONTENT)),
            })
        ).rejects.toThrow('checksum');

        expect(readdirSync(directory)).toEqual([]);
    });

    it('keeps nothing when the size differs', async () => {
        await expect(
            downloadAsar({
                url: 'https://example.test/app.asar.br',
                destination: join(directory, 'app.asar'),
                sha256: SHA,
                size: CONTENT.length + 1,
                fetcher: respond(brotliCompressSync(CONTENT)),
            })
        ).rejects.toThrow('bytes');

        expect(readdirSync(directory)).toEqual([]);
    });

    it('keeps nothing when the data is not brotli', async () => {
        await expect(
            downloadAsar({
                url: 'https://example.test/app.asar.br',
                destination: join(directory, 'app.asar'),
                sha256: SHA,
                size: CONTENT.length,
                fetcher: respond(Buffer.from('<html>not found</html>')),
            })
        ).rejects.toThrow();

        expect(readdirSync(directory)).toEqual([]);
    });

    it('reports an HTTP failure', async () => {
        await expect(
            downloadAsar({
                url: 'https://example.test/app.asar.br',
                destination: join(directory, 'app.asar'),
                sha256: SHA,
                size: CONTENT.length,
                fetcher: respond(Buffer.alloc(0), {
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                }),
            })
        ).rejects.toThrow('404');
    });
});
