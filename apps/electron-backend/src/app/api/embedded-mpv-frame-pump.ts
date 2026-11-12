/**
 * Frame pump for the frame-copy embedded MPV engine.
 *
 * Runs inside the preload script (isolated world, full Node access — the
 * frame-copy experiment disables the window sandbox, see
 * getMainWindowWebPreferences). It loads the shm frame-reader addon, copies
 * the newest BGRA frame into a reused ArrayBuffer once per rAF, and uploads
 * it into a WebGL2 texture on the renderer's `<canvas
 * data-embedded-mpv-frame>` element. No frame data ever crosses the
 * contextBridge — the bridge only exposes attach/detach lifecycle calls.
 */
import { ipcRenderer } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
    EMBEDDED_MPV_FRAME_SOURCE_CHANGED,
    EMBEDDED_MPV_GET_FRAME_SOURCE,
    EmbeddedMpvFrameSource,
} from '@iptvnator/shared/interfaces';

interface FrameReaderInfo {
    width: number;
    height: number;
    stride: number;
    frameBytes: number;
    generation: number;
}

interface FrameCopyResult {
    seq: number;
    ageMs: number;
    torn: boolean;
}

interface FrameReaderAddon {
    open(shmName: string): FrameReaderInfo;
    latestSeq(): number;
    copyLatest(buffer: ArrayBuffer): FrameCopyResult | null;
    producerAliveMs(): number;
    close(): void;
}

/* Webpack rewrites bare `require`; the addon must go through the runtime
 * require so the .node file is loaded by Node itself. */
declare const __non_webpack_require__: NodeRequire | undefined;
const nodeRequire: NodeRequire =
    typeof __non_webpack_require__ === 'function'
        ? __non_webpack_require__
        : require;

/**
 * A pump paints one helper session onto one canvas. `main` is the player
 * picture; `preview` is the small audio-sync window (a second, independent
 * session that only shows the scoreboard of the audio channel).
 */
export type FramePumpRole = 'main' | 'preview';

const CANVAS_SELECTORS: Record<FramePumpRole, string> = {
    main: 'canvas[data-embedded-mpv-frame]',
    preview: 'canvas[data-embedded-mpv-preview]',
};
const ATTACH_TIMEOUT_MS = 5000;
const ATTACH_POLL_MS = 100;

// Note on orientation: the helper renders with MPV_RENDER_PARAM_FLIP_Y and
// glReadPixels reads rows bottom-up, so the shm buffer arrives in texture
// order already — sampling uses the un-flipped uv (a second flip here would
// show the video upside down).
const VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
    vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    v_uv = corner;
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o_color;
void main() {
    vec4 c = texture(u_tex, v_uv);
    o_color = vec4(c.b, c.g, c.r, 1.0);
}`;

interface PumpState {
    sessionId: string;
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    texture: WebGLTexture;
    reader: FrameReaderAddon;
    frame: Uint8Array;
    width: number;
    height: number;
    lastSeq: number;
    /** performance.now() of the last frame that reached the canvas. */
    lastFrameAt: number;
    rafHandle: number;
}

const pumps = new Map<FramePumpRole, PumpState>();
let sourceListenerRegistered = false;
/**
 * Monotonic attach epoch per role: bumped by every attach/detach. Async
 * attach waits re-check it after each await so a stale attach (for a session
 * that was replaced meanwhile) can never install itself over the active pump.
 */
const attachEpochs: Record<FramePumpRole, number> = { main: 0, preview: 0 };

export function copyStableLatestFrame(
    reader: Pick<FrameReaderAddon, 'latestSeq' | 'copyLatest'>,
    buffer: ArrayBuffer,
    lastSeq: number
): FrameCopyResult | null {
    if (reader.latestSeq() <= lastSeq) return null;

    const result = reader.copyLatest(buffer);
    // A torn memcpy raced the helper overwriting this ring slot. Keep the
    // previous sequence so the next animation tick retries instead of
    // uploading partially copied pixels or marking the frame consumed.
    return result && !result.torn ? result : null;
}

/**
 * The addon keeps one open frame ring in static state, and Node loads one
 * copy of a .node file per path. Two pumps sharing it would swap rings under
 * each other: the preview opening its own ring made the main picture read the
 * wrong ring, throw "buffer smaller than one frame" on every tick and freeze.
 * Each extra role therefore loads its own copy of the file, which the system
 * loads as a separate library with separate state.
 */
export function readerPathForRole(
    role: FramePumpRole,
    readerPath: string
): string {
    if (role === 'main') return readerPath;
    const folder = join(tmpdir(), 'iptvnator-frame-reader');
    mkdirSync(folder, { recursive: true });
    const copy = join(folder, `${process.pid}-${role}-${basename(readerPath)}`);
    // A loaded library cannot be overwritten on Windows: copy it once.
    if (!existsSync(copy)) copyFileSync(readerPath, copy);
    return copy;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCanvas(
    role: FramePumpRole
): Promise<HTMLCanvasElement | null> {
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const canvas = document.querySelector<HTMLCanvasElement>(
            CANVAS_SELECTORS[role]
        );
        if (canvas) return canvas;
        await delay(ATTACH_POLL_MS);
    }
    return null;
}

async function waitForFrameSource(
    sessionId: string
): Promise<EmbeddedMpvFrameSource | null> {
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const source = (await ipcRenderer.invoke(
            EMBEDDED_MPV_GET_FRAME_SOURCE,
            sessionId
        )) as EmbeddedMpvFrameSource | null;
        if (source?.shmName) return source;
        await delay(ATTACH_POLL_MS);
    }
    return null;
}

function createGl(
    canvas: HTMLCanvasElement
): { gl: WebGL2RenderingContext; texture: WebGLTexture } | null {
    const gl = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    const program = gl.createProgram();
    for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX_SHADER],
        [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
    ] as const) {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(
                '[embedded-mpv-pump] shader error:',
                gl.getShaderInfoLog(shader)
            );
            return null;
        }
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    gl.useProgram(program);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { gl, texture: texture as WebGLTexture };
}

function applySource(state: PumpState, source: EmbeddedMpvFrameSource): boolean {
    try {
        const info = state.reader.open(source.shmName);
        state.width = info.width;
        state.height = info.height;
        state.frame = new Uint8Array(info.frameBytes);
        state.lastSeq = 0;
        state.canvas.width = info.width;
        state.canvas.height = info.height;
        state.gl.viewport(0, 0, info.width, info.height);
        state.gl.texImage2D(
            state.gl.TEXTURE_2D,
            0,
            state.gl.RGBA,
            info.width,
            info.height,
            0,
            state.gl.RGBA,
            state.gl.UNSIGNED_BYTE,
            null
        );
        return true;
    } catch (error) {
        console.error('[embedded-mpv-pump] failed to open frame ring:', error);
        return false;
    }
}

function pumpTick(role: FramePumpRole): void {
    const pump = pumps.get(role);
    if (!pump) return;
    pump.rafHandle = requestAnimationFrame(() => pumpTick(role));

    const { gl, reader, frame } = pump;
    const result = copyStableLatestFrame(
        reader,
        frame.buffer as ArrayBuffer,
        pump.lastSeq
    );
    if (result) {
        pump.lastFrameAt = performance.now();
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            pump.width,
            pump.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            frame
        );
        pump.lastSeq = result.seq;
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
}

function ensureSourceListener(): void {
    if (sourceListenerRegistered) return;
    sourceListenerRegistered = true;
    ipcRenderer.on(
        EMBEDDED_MPV_FRAME_SOURCE_CHANGED,
        (_event, payload: { sessionId: string; source: EmbeddedMpvFrameSource }) => {
            for (const pump of pumps.values()) {
                if (payload.sessionId === pump.sessionId) {
                    applySource(pump, payload.source);
                }
            }
        }
    );
}

export async function attachEmbeddedMpvFrameView(
    sessionId: string,
    role: FramePumpRole = 'main'
): Promise<boolean> {
    detachEmbeddedMpvFrameView(role);
    const epoch = ++attachEpochs[role];
    ensureSourceListener();

    const canvas = await waitForCanvas(role);
    if (epoch !== attachEpochs[role]) return false;
    if (!canvas) {
        console.error('[embedded-mpv-pump] frame canvas not found in DOM');
        return false;
    }
    const source = await waitForFrameSource(sessionId);
    if (epoch !== attachEpochs[role]) return false;
    if (!source) {
        console.error('[embedded-mpv-pump] no frame source for', sessionId);
        return false;
    }

    let reader: FrameReaderAddon;
    try {
        reader = nodeRequire(
            readerPathForRole(role, source.readerPath)
        ) as FrameReaderAddon;
    } catch (error) {
        console.error('[embedded-mpv-pump] failed to load reader:', error);
        return false;
    }

    const glSetup = createGl(canvas);
    if (!glSetup) {
        console.error('[embedded-mpv-pump] WebGL2 unavailable');
        return false;
    }

    const state: PumpState = {
        sessionId,
        canvas,
        gl: glSetup.gl,
        texture: glSetup.texture,
        reader,
        frame: new Uint8Array(0),
        width: 0,
        height: 0,
        lastSeq: 0,
        lastFrameAt: 0,
        rafHandle: 0,
    };
    if (!applySource(state, source)) {
        reader.close();
        return false;
    }

    pumps.set(role, state);
    state.rafHandle = requestAnimationFrame(() => pumpTick(role));
    return true;
}

export function detachEmbeddedMpvFrameView(
    role: FramePumpRole = 'main'
): void {
    attachEpochs[role]++; // aborts any attach still waiting on canvas/frame source
    const pump = pumps.get(role);
    if (!pump) return;
    cancelAnimationFrame(pump.rafHandle);
    try {
        pump.reader.close();
    } catch {
        // reader may already be gone with the helper; nothing to release
    }
    pumps.delete(role);
}

/** Normalised (0..1) rectangle of a frame. */
export interface FrameRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CapturedFrame {
    width: number;
    height: number;
    /** RGBA, ready for ImageData. */
    data: Uint8ClampedArray;
    /** Milliseconds since this frame reached the canvas. */
    ageMs: number;
    seq: number;
}

/**
 * Copies a region of the newest frame the pump holds (the pixel buffer lives
 * in this isolated world, so the renderer asks for it instead of reading the
 * WebGL canvas, whose back buffer is cleared after every present). Returns
 * null when no frame has arrived yet. `maxWidth` decimates large frames so a
 * full-frame grab for the region picker stays small.
 */
export function captureEmbeddedMpvFrame(
    role: FramePumpRole,
    region?: FrameRegion,
    maxWidth?: number
): CapturedFrame | null {
    const pump = pumps.get(role);
    if (!pump || pump.lastSeq === 0 || pump.width === 0) return null;
    return extractRegion(
        pump.frame,
        pump.width,
        pump.height,
        region,
        maxWidth,
        performance.now() - pump.lastFrameAt,
        pump.lastSeq
    );
}

export function extractRegion(
    bgra: Uint8Array,
    width: number,
    height: number,
    region: FrameRegion | undefined,
    maxWidth: number | undefined,
    ageMs: number,
    seq: number
): CapturedFrame | null {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const rx = clamp(region?.x ?? 0);
    const ry = clamp(region?.y ?? 0);
    const left = Math.floor(rx * width);
    const top = Math.floor(ry * height);
    const right = Math.min(
        width,
        Math.max(left + 1, Math.ceil(clamp(rx + (region?.width ?? 1)) * width))
    );
    const bottom = Math.min(
        height,
        Math.max(top + 1, Math.ceil(clamp(ry + (region?.height ?? 1)) * height))
    );
    const sourceWidth = right - left;
    const sourceHeight = bottom - top;
    if (sourceWidth < 1 || sourceHeight < 1) return null;

    const step =
        maxWidth && sourceWidth > maxWidth
            ? Math.ceil(sourceWidth / maxWidth)
            : 1;
    const outWidth = Math.ceil(sourceWidth / step);
    const outHeight = Math.ceil(sourceHeight / step);
    const data = new Uint8ClampedArray(outWidth * outHeight * 4);
    let out = 0;
    for (let y = 0; y < outHeight; y++) {
        // The buffer is in texture order: its first row is the BOTTOM of the
        // picture (see the orientation note above). Rows are read from the
        // far end so the result, like `region`, is top-down: an upright
        // picture that OCR and the region picker can use as it looks.
        const rowStart =
            ((height - 1 - (top + y * step)) * width + left) * 4;
        for (let x = 0; x < outWidth; x++) {
            const index = rowStart + x * step * 4;
            data[out++] = bgra[index + 2];
            data[out++] = bgra[index + 1];
            data[out++] = bgra[index];
            data[out++] = 255;
        }
    }
    return { width: outWidth, height: outHeight, data, ageMs, seq };
}
