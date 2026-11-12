const homedirMock = jest.fn<string, []>();

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => homedirMock(),
}));

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    IPTVNATOR_DATA_DIR_ENV,
    IPTVNATOR_E2E_DATA_DIR_ENV,
    getElectronConfigDirectory,
    getElectronUserDataPath,
    getIptvnatorDataRoot,
    getIptvnatorDatabaseDirectory,
    getIptvnatorDatabasePath,
} from './path-utils';

describe('path-utils', () => {
    let tempRoot: string;
    let originalEnvValue: string | undefined;
    let originalDataDirValue: string | undefined;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'iptvnator-path-utils-'));
        homedirMock.mockReturnValue(join(tempRoot, 'home'));
        originalEnvValue = process.env[IPTVNATOR_E2E_DATA_DIR_ENV];
        delete process.env[IPTVNATOR_E2E_DATA_DIR_ENV];
        originalDataDirValue = process.env[IPTVNATOR_DATA_DIR_ENV];
        delete process.env[IPTVNATOR_DATA_DIR_ENV];
    });

    afterEach(() => {
        if (originalEnvValue === undefined) {
            delete process.env[IPTVNATOR_E2E_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = originalEnvValue;
        }
        if (originalDataDirValue === undefined) {
            delete process.env[IPTVNATOR_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_DATA_DIR_ENV] = originalDataDirValue;
        }
        rmSync(tempRoot, { force: true, recursive: true });
    });

    it('uses and creates IPTVNATOR_DATA_DIR as the data root', () => {
        const dataDir = join(tempRoot, 'volume');
        process.env[IPTVNATOR_DATA_DIR_ENV] = ` ${dataDir} `;

        expect(getIptvnatorDataRoot()).toBe(dataDir);
        expect(existsSync(dataDir)).toBe(true);
        expect(getIptvnatorDatabasePath()).toBe(
            join(dataDir, 'databases', 'iptvnator.db')
        );
    });

    it('isolates a selected server profile without changing the standalone data root', () => {
        const previous = process.env['IPTVNATOR_SOURCE_PROFILE'];
        const profile = 'a'.repeat(64);
        process.env['IPTVNATOR_SOURCE_PROFILE'] = profile;
        process.env[IPTVNATOR_DATA_DIR_ENV] = tempRoot;
        try {
            expect(getIptvnatorDatabasePath()).toBe(join(tempRoot, 'server-profiles', profile, 'databases', 'iptvnator.db'));
            expect(getIptvnatorDataRoot()).toBe(tempRoot);
            process.env['IPTVNATOR_SOURCE_PROFILE'] = '../outside';
            expect(getIptvnatorDatabasePath()).toBe(join(tempRoot, 'databases', 'iptvnator.db'));
        } finally {
            if (previous === undefined) delete process.env['IPTVNATOR_SOURCE_PROFILE'];
            else process.env['IPTVNATOR_SOURCE_PROFILE'] = previous;
        }
    });

    it('lets the E2E override win over IPTVNATOR_DATA_DIR', () => {
        const e2eDir = join(tempRoot, 'e2e');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDir;
        process.env[IPTVNATOR_DATA_DIR_ENV] = join(tempRoot, 'volume');

        expect(getIptvnatorDataRoot()).toBe(e2eDir);
    });

    it('ignores a blank IPTVNATOR_DATA_DIR', () => {
        process.env[IPTVNATOR_DATA_DIR_ENV] = '   ';

        expect(getIptvnatorDataRoot()).toBe(
            join(tempRoot, 'home', '.d7my-tv')
        );
    });

    it('uses and creates the E2E data dir override when the env variable is set', () => {
        const e2eDataDir = join(tempRoot, 'e2e-data');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDataDir;

        expect(getIptvnatorDataRoot()).toBe(e2eDataDir);
        expect(existsSync(e2eDataDir)).toBe(true);
    });

    it('falls back to ~/.d7my-tv when the env override is blank', () => {
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = '   ';

        const expectedRoot = join(tempRoot, 'home', '.d7my-tv');

        expect(getIptvnatorDataRoot()).toBe(expectedRoot);
        expect(existsSync(expectedRoot)).toBe(true);
    });

    describe('data written under the former ~/.iptvnator folder', () => {
        const legacyRoot = () => join(tempRoot, 'home', '.iptvnator');
        const targetRoot = () => join(tempRoot, 'home', '.d7my-tv');

        function seedLegacy(): void {
            mkdirSync(join(legacyRoot(), 'databases'), { recursive: true });
            writeFileSync(
                join(legacyRoot(), 'databases', 'iptvnator.db'),
                'playlists'
            );
        }

        it('is copied to ~/.d7my-tv on first use and the old folder is kept', () => {
            seedLegacy();

            expect(getIptvnatorDataRoot()).toBe(targetRoot());
            expect(
                readFileSync(
                    join(targetRoot(), 'databases', 'iptvnator.db'),
                    'utf8'
                )
            ).toBe('playlists');
            expect(
                readFileSync(
                    join(legacyRoot(), 'databases', 'iptvnator.db'),
                    'utf8'
                )
            ).toBe('playlists');
            expect(
                readdirSync(join(tempRoot, 'home')).filter((name) =>
                    name.includes('migrating')
                )
            ).toEqual([]);
        });

        it('never overwrites a ~/.d7my-tv that already exists', () => {
            seedLegacy();
            mkdirSync(join(targetRoot(), 'databases'), { recursive: true });
            writeFileSync(
                join(targetRoot(), 'databases', 'iptvnator.db'),
                'newer'
            );

            expect(getIptvnatorDataRoot()).toBe(targetRoot());
            expect(
                readFileSync(
                    join(targetRoot(), 'databases', 'iptvnator.db'),
                    'utf8'
                )
            ).toBe('newer');
        });

        it('creates an empty ~/.d7my-tv when there is nothing to migrate', () => {
            expect(getIptvnatorDataRoot()).toBe(targetRoot());
            expect(readdirSync(targetRoot())).toEqual([]);
            expect(existsSync(legacyRoot())).toBe(false);
        });

        it('leaves an explicit IPTVNATOR_DATA_DIR alone', () => {
            seedLegacy();
            const custom = join(tempRoot, 'custom');
            process.env[IPTVNATOR_DATA_DIR_ENV] = custom;

            expect(getIptvnatorDataRoot()).toBe(custom);
            expect(existsSync(targetRoot())).toBe(false);
        });
    });

    it('places the databases directory and database file under the data root', () => {
        const e2eDataDir = join(tempRoot, 'e2e-data');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDataDir;

        const databaseDirectory = getIptvnatorDatabaseDirectory();

        expect(databaseDirectory).toBe(join(e2eDataDir, 'databases'));
        expect(existsSync(databaseDirectory)).toBe(true);
        expect(getIptvnatorDatabasePath()).toBe(
            join(e2eDataDir, 'databases', 'iptvnator.db')
        );
    });

    it('returns null Electron user-data and config paths outside E2E runs', () => {
        expect(getElectronUserDataPath()).toBeNull();
        expect(getElectronConfigDirectory()).toBeNull();
    });

    it('creates Electron user-data and config directories under the E2E root', () => {
        const e2eDataDir = join(tempRoot, 'e2e-data');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDataDir;

        const userDataPath = getElectronUserDataPath();
        const configDirectory = getElectronConfigDirectory();

        expect(userDataPath).toBe(join(e2eDataDir, 'user-data'));
        expect(configDirectory).toBe(join(e2eDataDir, 'config'));
        expect(existsSync(userDataPath as string)).toBe(true);
        expect(existsSync(configDirectory as string)).toBe(true);
    });
});
