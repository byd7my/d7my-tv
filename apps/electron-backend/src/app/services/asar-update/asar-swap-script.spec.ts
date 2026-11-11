import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASAR_SWAP_SCRIPT } from './asar-swap-script';

/** The real script, run by real Node on real files. */
describe('ASAR_SWAP_SCRIPT', () => {
    let directory: string;
    let script: string;
    let marker: string;
    let log: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'asar-swap-'));
        script = join(directory, 'swap.cjs');
        marker = join(directory, 'relaunched.txt');
        log = join(directory, 'swap.log');
        writeFileSync(script, ASAR_SWAP_SCRIPT);
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    /** A pid that is certainly gone: a process that already ended. */
    function exitedPid(): number {
        return spawnSync(process.execPath, ['-e', '']).pid;
    }

    function run(source: string, target: string) {
        return spawnSync(process.execPath, [
            script,
            String(exitedPid()),
            source,
            target,
            process.execPath,
            log,
            // relaunch arguments: the "app" just leaves a marker
            '-e',
            `require('fs').writeFileSync(${JSON.stringify(marker)}, 'up')`,
        ]);
    }

    async function waitFor(path: string): Promise<boolean> {
        for (let i = 0; i < 100; i += 1) {
            if (existsSync(path)) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
    }

    it('replaces the target, keeps the old one as .bak and relaunches', async () => {
        const source = join(directory, 'downloaded.asar');
        const target = join(directory, 'app.asar');
        writeFileSync(source, 'new code');
        writeFileSync(target, 'old code');

        const result = run(source, target);

        expect(result.status).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('new code');
        expect(readFileSync(`${target}.bak`, 'utf8')).toBe('old code');
        expect(existsSync(`${target}.new`)).toBe(false);
        expect(existsSync(source)).toBe(false);
        expect(await waitFor(marker)).toBe(true);
        expect(readFileSync(log, 'utf8')).toContain('swapped');
    });

    it('replaces an older .bak', () => {
        const source = join(directory, 'downloaded.asar');
        const target = join(directory, 'app.asar');
        writeFileSync(source, 'newest');
        writeFileSync(target, 'current');
        writeFileSync(`${target}.bak`, 'ancient');

        run(source, target);

        expect(readFileSync(`${target}.bak`, 'utf8')).toBe('current');
    });

    it('leaves the old code in place and still relaunches when the swap fails', async () => {
        const target = join(directory, 'app.asar');
        writeFileSync(target, 'old code');

        const result = run(join(directory, 'missing.asar'), target);

        expect(result.status).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('old code');
        expect(existsSync(`${target}.new`)).toBe(false);
        expect(await waitFor(marker)).toBe(true);
        expect(readFileSync(log, 'utf8')).toContain('swap failed');
    });
});
