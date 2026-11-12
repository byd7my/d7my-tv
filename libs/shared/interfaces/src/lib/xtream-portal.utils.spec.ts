import {
    extractXtreamAccountFromStreamUrl,
    extractXtreamCredentialsFromUrl,
    normalizeXtreamServerUrl,
    resolveXtreamConnectionLimits,
    resolveXtreamPortalExpiration,
    resolveXtreamPortalStatus,
} from './xtream-portal.utils';

describe('xtream portal utilities', () => {
    describe('normalizeXtreamServerUrl', () => {
        it.each([
            [' https://example.com/ ', 'https://example.com'],
            ['https://example.com/base/', 'https://example.com/base'],
            [
                'https://example.com/get.php?username=user&password=pass&type=m3u_plus',
                'https://example.com',
            ],
            [
                'https://example.com/base/player_api.php?username=user&password=pass',
                'https://example.com/base',
            ],
        ])('normalizes %s to %s', (input, expected) => {
            expect(normalizeXtreamServerUrl(input)).toBe(expected);
        });

        it('rejects non-http portal URLs', () => {
            expect(() =>
                normalizeXtreamServerUrl('file://example.com/portal')
            ).toThrow('Only http and https Xtream URLs are supported');
        });
    });

    describe('extractXtreamCredentialsFromUrl', () => {
        it('extracts and trims credentials from a full Xtream playlist URL', () => {
            expect(
                extractXtreamCredentialsFromUrl(
                    'https://example.com/get.php?username=%20user%20&password=%20pass%20&type=m3u_plus'
                )
            ).toEqual({
                username: 'user',
                password: 'pass',
            });
        });

        it('returns null when the URL has no usable credentials', () => {
            expect(
                extractXtreamCredentialsFromUrl('https://example.com/get.php')
            ).toBeNull();
        });
    });

    describe('resolveXtreamPortalStatus', () => {
        const now = new Date('2026-06-14T00:00:00.000Z');

        it('accepts active status case-insensitively and treats exp_date 0 as unlimited', () => {
            expect(
                resolveXtreamPortalStatus(
                    {
                        user_info: {
                            auth: 1,
                            status: 'active',
                            exp_date: '0',
                        },
                    },
                    now
                )
            ).toBe('active');
        });

        it('uses auth=1 as active when status is missing', () => {
            expect(
                resolveXtreamPortalStatus(
                    {
                        user_info: {
                            auth: '1',
                            exp_date: String(now.getTime() / 1000 + 3600),
                        },
                    },
                    now
                )
            ).toBe('active');
        });

        it('marks explicit auth failure as inactive', () => {
            expect(
                resolveXtreamPortalStatus({
                    user_info: {
                        auth: 0,
                    },
                })
            ).toBe('inactive');
        });

        it('marks active accounts with past expiration as expired', () => {
            expect(
                resolveXtreamPortalStatus(
                    {
                        user_info: {
                            auth: 1,
                            status: 'Active',
                            exp_date: String(now.getTime() / 1000 - 3600),
                        },
                    },
                    now
                )
            ).toBe('expired');
        });
    });

    describe('resolveXtreamPortalExpiration', () => {
        it('parses numeric-string exp_date into unix seconds', () => {
            expect(
                resolveXtreamPortalExpiration({
                    user_info: { exp_date: '1790000000' },
                })
            ).toBe(1_790_000_000);
        });

        it('treats unlimited and absent expirations as null', () => {
            expect(
                resolveXtreamPortalExpiration({
                    user_info: { exp_date: '0' },
                })
            ).toBeNull();
            expect(
                resolveXtreamPortalExpiration({
                    user_info: { exp_date: '' },
                })
            ).toBeNull();
            expect(resolveXtreamPortalExpiration({ user_info: {} })).toBeNull();
            expect(resolveXtreamPortalExpiration(null)).toBeNull();
        });

        it('rejects non-numeric exp_date values', () => {
            expect(
                resolveXtreamPortalExpiration({
                    user_info: { exp_date: 'never' },
                })
            ).toBeNull();
        });
    });
    describe('extractXtreamAccountFromStreamUrl', () => {
        it.each([
            [
                'http://host.example:8080/live/user1/pass1/123.ts',
                {
                    serverUrl: 'http://host.example:8080',
                    username: 'user1',
                    password: 'pass1',
                },
            ],
            [
                'https://host.example/user1/pass1/456',
                {
                    serverUrl: 'https://host.example',
                    username: 'user1',
                    password: 'pass1',
                },
            ],
            [
                'https://host.example/panel/live/u/p/9.m3u8',
                {
                    serverUrl: 'https://host.example/panel',
                    username: 'u',
                    password: 'p',
                },
            ],
            [
                'http://host.example/movie/a%20b/c%2Fd/77.mkv',
                {
                    serverUrl: 'http://host.example',
                    username: 'a b',
                    password: 'c/d',
                },
            ],
        ])('reads the account from %s', (value, expected) => {
            expect(extractXtreamAccountFromStreamUrl(value)).toEqual(expected);
        });

        it.each([
            'not a url',
            'rtsp://host.example/live/u/p/1.ts',
            'http://host.example/stream.m3u8',
            'http://host.example/channels/news/live.m3u8',
            'http://host.example/a/b/c/d/e.ts',
        ])('does not mistake %s for an Xtream stream', (value) => {
            expect(extractXtreamAccountFromStreamUrl(value)).toBeNull();
        });
    });

    describe('resolveXtreamConnectionLimits', () => {
        it('reads the allowed and the open connections', () => {
            expect(
                resolveXtreamConnectionLimits({
                    user_info: { max_connections: '2', active_cons: '1' },
                })
            ).toEqual({ max: 2, active: 1 });
        });

        it('keeps the limit when the open count is missing', () => {
            expect(
                resolveXtreamConnectionLimits({
                    user_info: { max_connections: 3, active_cons: '' },
                })
            ).toEqual({ max: 3, active: null });
        });

        it.each([
            { user_info: {} },
            { user_info: { max_connections: '0' } },
            { user_info: { max_connections: 'many' } },
            null,
            undefined,
        ])('has no limit for %j', (response) => {
            expect(resolveXtreamConnectionLimits(response)).toBeNull();
        });
    });
});
