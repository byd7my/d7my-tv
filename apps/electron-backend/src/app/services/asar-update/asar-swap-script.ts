import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Runs after the app has quit: Windows will not replace `app.asar` while the
 * app still has it open, so a second process does the swap. That process is
 * the app's own executable started in plain-Node mode (ELECTRON_RUN_AS_NODE),
 * not a new program, so nothing unknown has to be allowed to run.
 *
 * Plain CommonJS on purpose: it is written to disk and run by Node, outside
 * the bundle. Arguments: pid, source, target, executable, log file, then any
 * arguments for the relaunch.
 *
 * The new file is staged next to the target first, so the only work left once
 * the app is gone is two renames; the old file stays as `<target>.bak`. If the
 * swap fails the old code is restored, and the app is relaunched either way.
 */
export const ASAR_SWAP_SCRIPT = `'use strict';
const fs = require('fs');
const cp = require('child_process');
const [pidArg, source, target, executable, logFile, ...relaunchArgs] =
    process.argv.slice(2);

function log(message) {
    try {
        fs.appendFileSync(logFile, new Date().toISOString() + ' ' + message + '\\n');
    } catch (error) {
        // the log is best effort
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

async function swap() {
    const pid = Number(pidArg);
    const staged = target + '.new';
    const backup = target + '.bak';

    fs.copyFileSync(source, staged);
    if (fs.statSync(staged).size !== fs.statSync(source).size) {
        throw new Error('staged copy has the wrong size');
    }

    for (let i = 0; alive(pid) && i < 240; i += 1) {
        await sleep(250);
    }
    if (alive(pid)) {
        throw new Error('the app did not exit');
    }

    // Other Electron processes can hold the file a moment longer.
    let lastError = null;
    for (let i = 0; i < 120; i += 1) {
        try {
            fs.rmSync(backup, { force: true });
            fs.renameSync(target, backup);
            try {
                fs.renameSync(staged, target);
            } catch (error) {
                fs.renameSync(backup, target);
                throw error;
            }
            fs.rmSync(source, { force: true });
            return;
        } catch (error) {
            lastError = error;
            await sleep(500);
        }
    }
    throw lastError;
}

function relaunch() {
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        cp.spawn(executable, relaunchArgs, {
            detached: true,
            stdio: 'ignore',
            env,
        }).unref();
        log('relaunched');
    } catch (error) {
        log('relaunch failed: ' + error.message);
    }
}

swap().then(
    () => {
        log('swapped ' + target);
        relaunch();
    },
    (error) => {
        log('swap failed: ' + error.message);
        try {
            fs.rmSync(target + '.new', { force: true });
        } catch (cleanupError) {
            // nothing to clean
        }
        relaunch();
    }
);
`;

export interface AsarSwapRequest {
    /** Folder for the script and its log; created when missing. */
    workDirectory: string;
    source: string;
    target: string;
    executable: string;
    pid: number;
}

/** Starts the swap as a detached process that outlives the app. */
export function launchAsarSwap(request: AsarSwapRequest): void {
    mkdirSync(request.workDirectory, { recursive: true });
    const script = join(request.workDirectory, 'swap-asar.cjs');
    writeFileSync(script, ASAR_SWAP_SCRIPT);

    const child = spawn(
        request.executable,
        [
            script,
            String(request.pid),
            request.source,
            request.target,
            request.executable,
            join(request.workDirectory, 'swap.log'),
        ],
        {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        }
    );

    child.unref();
}
