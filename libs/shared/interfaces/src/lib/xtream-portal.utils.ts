export type XtreamPortalStatusType =
    'active' | 'inactive' | 'expired' | 'unavailable';

export interface XtreamPortalStatusResponseLike {
    user_info?: {
        auth?: boolean | number | string | null;
        exp_date?: number | string | null;
        status?: string | null;
        max_connections?: number | string | null;
        active_cons?: number | string | null;
    } | null;
}

/** What a subscription allows at the same time, and what is in use now. */
export interface XtreamConnectionLimits {
    /** Simultaneous connections the subscription allows (at least 1). */
    max: number;
    /** Connections the server counts as open right now; null when unknown. */
    active: number | null;
}

export interface XtreamStreamAccount extends XtreamCredentialsFromUrl {
    /** Base address of the panel, without a trailing slash. */
    serverUrl: string;
}

export interface XtreamCredentialsFromUrl {
    password: string;
    username: string;
}

// panel_api.php is the legacy admin-flavored endpoint some panels hand out;
// it identifies an Xtream server just like the other two and must be
// stripped the same way, or the transport would append /player_api.php to it.
const XTREAM_API_ENDPOINT_PATTERN = /\/(?:get|player_api|panel_api)\.php$/i;

// Some Xtream panels challenge generic Node HTTP clients while allowing
// established IPTV players. Keep API, probe, and download requests aligned.
export const XTREAM_CLIENT_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

export function normalizeXtreamServerUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Xtream URL is required');
    }

    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https Xtream URLs are supported');
    }

    if (url.username || url.password) {
        throw new Error('URL credentials are not supported');
    }

    const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, '');
    const basePath = pathWithoutTrailingSlash.replace(
        XTREAM_API_ENDPOINT_PATTERN,
        ''
    );

    return `${url.origin}${basePath}`;
}

export function extractXtreamCredentialsFromUrl(
    value: string
): XtreamCredentialsFromUrl | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }

    const username = url.searchParams.get('username')?.trim() ?? '';
    const password = url.searchParams.get('password')?.trim() ?? '';

    if (!username || !password) {
        return null;
    }

    return { username, password };
}

const STREAM_KIND_SEGMENTS = new Set(['live', 'movie', 'series', 'timeshift']);
const STREAM_ID_SEGMENT = /^\d+(?:\.[A-Za-z0-9]+)?$/;

/**
 * Reads the panel address and the account out of a stream address like
 * `http://host:8080/live/user/pass/123.ts` (the `/live` part is optional).
 * Anything that does not look like that returns null, so an ordinary playlist
 * address is never mistaken for an Xtream account.
 */
export function extractXtreamAccountFromStreamUrl(
    value: string
): XtreamStreamAccount | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const kindIndex = segments.findIndex(
        (segment, index) =>
            STREAM_KIND_SEGMENTS.has(segment) && segments.length - index === 4
    );
    const start = kindIndex >= 0 ? kindIndex + 1 : segments.length - 3;
    const [username, password, id] = segments.slice(start, start + 3);
    if (start < 0 || !username || !password || !id) return null;
    if (!STREAM_ID_SEGMENT.test(id)) return null;
    // Without the /live-style marker only the bare user/pass/id shape counts.
    if (kindIndex < 0 && segments.length !== 3) return null;

    const prefix = segments.slice(0, kindIndex >= 0 ? kindIndex : 0).join('/');
    return {
        serverUrl: `${url.origin}${prefix ? `/${prefix}` : ''}`,
        username: decodeURIComponent(username),
        password: decodeURIComponent(password),
    };
}

/**
 * Reads how many simultaneous connections the subscription allows from an
 * Xtream `get_account_info` response. Returns null when the panel does not
 * say (a missing, empty or non-positive value is not a limit).
 */
export function resolveXtreamConnectionLimits(
    response: XtreamPortalStatusResponseLike | null | undefined
): XtreamConnectionLimits | null {
    const max = Number(response?.user_info?.max_connections);
    if (!Number.isFinite(max) || max < 1) return null;
    const rawActive = response?.user_info?.active_cons;
    const active =
        rawActive === null || rawActive === undefined || rawActive === ''
            ? NaN
            : Number(rawActive);
    return {
        max: Math.floor(max),
        active:
            Number.isFinite(active) && active >= 0 ? Math.floor(active) : null,
    };
}

export function resolveXtreamPortalStatus(
    response: XtreamPortalStatusResponseLike | null | undefined,
    now = new Date()
): XtreamPortalStatusType {
    const userInfo = response?.user_info;
    if (!userInfo) {
        return 'unavailable';
    }

    const auth = normalizeAuthValue(userInfo.auth);
    if (auth === false) {
        return 'inactive';
    }

    const normalizedStatus = userInfo.status?.trim().toLowerCase() ?? '';
    if (normalizedStatus === 'expired') {
        return 'expired';
    }

    const isActive =
        normalizedStatus === 'active' ||
        (auth === true && normalizedStatus.length === 0);

    if (!isActive) {
        return normalizedStatus ? 'inactive' : 'unavailable';
    }

    const expirationTimestamp = parseXtreamExpiration(userInfo.exp_date);
    if (
        expirationTimestamp !== null &&
        expirationTimestamp * 1000 < now.getTime()
    ) {
        return 'expired';
    }

    return 'active';
}

/**
 * Reads the account expiration from an Xtream `get_account_info`-style
 * response as unix seconds. Returns null when the portal doesn't report one
 * (unlimited accounts answer with empty/zero/absent `exp_date`).
 */
export function resolveXtreamPortalExpiration(
    response: XtreamPortalStatusResponseLike | null | undefined
): number | null {
    return parseXtreamExpiration(response?.user_info?.exp_date);
}

function normalizeAuthValue(
    value: boolean | number | string | null | undefined
): boolean | null {
    if (value === true || value === 1 || value === '1') {
        return true;
    }

    if (value === false || value === 0 || value === '0') {
        return false;
    }

    return null;
}

function parseXtreamExpiration(
    value: number | string | null | undefined
): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}
