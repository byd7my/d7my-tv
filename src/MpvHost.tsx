import { ExpoMpvView, type ExpoMpvViewRef } from 'expo-mpv';
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';

import D7TNative from '../modules/d7t-native';

export type Bounds = { x: number; y: number; width: number; height: number };

type Session = {
  id: string;
  bounds: Bounds;
  hidden: boolean;
  volume: number;
  paused: boolean;
  speed: number;
  source?: string;
  startPosition?: number;
};

export type MpvEvent = { sid: string; type: string; [k: string]: unknown };

export type MpvHostHandle = {
  /** Handles one `mpv.*` call from the page. */
  call(method: string, args: Record<string, any>): Promise<unknown>;
};

type Props = { emit: (event: MpvEvent) => void };

/**
 * Real mpv players (expo-mpv / libmpv, hardware decoding) drawn behind the transparent web page.
 * The page decides where each one goes (its player box) and what it plays; this component only obeys.
 */
export const MpvHost = forwardRef<MpvHostHandle, Props>(function MpvHost({ emit }, handle) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const refs = useRef(new Map<string, ExpoMpvViewRef>());
  const shotCopyTried = useRef(new Set<string>());
  const shotReady = useRef(new Set<string>());
  const waiters = useRef(new Map<string, Array<(r: ExpoMpvViewRef) => void>>());

  const patch = useCallback((id: string, change: Partial<Session>) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)));
  }, []);

  const withView = useCallback(async (id: string): Promise<ExpoMpvViewRef> => {
    const have = refs.current.get(id);
    if (have) return have;
    return new Promise<ExpoMpvViewRef>((resolve, reject) => {
      const list = waiters.current.get(id) ?? [];
      list.push(resolve);
      waiters.current.set(id, list);
      setTimeout(() => reject(new Error('player view not ready')), 8000);
    });
  }, []);

  const setRef = useCallback((id: string, view: ExpoMpvViewRef | null) => {
    if (!view) {
      refs.current.delete(id);
      return;
    }
    refs.current.set(id, view);
    const list = waiters.current.get(id);
    if (list) {
      waiters.current.delete(id);
      list.forEach((fn) => fn(view));
    }
  }, []);

  const applyOptions = async (view: ExpoMpvViewRef, options: string[] | undefined) => {
    for (const raw of options ?? []) {
      const text = raw.replace(/^--/, '');
      const eq = text.indexOf('=');
      const name = eq === -1 ? text : text.slice(0, eq);
      const value = eq === -1 ? 'yes' : text.slice(eq + 1);
      try {
        await view.setPropertyString(name, value);
      } catch {
        /* an option mpv will not change at run time is skipped */
      }
    }
  };

  useImperativeHandle(
    handle,
    () => ({
      async call(method, a) {
        switch (method) {
          case 'mpv.create': {
            const session: Session = {
              id: a.sid,
              bounds: a.bounds,
              hidden: !!a.hidden,
              volume: a.volume ?? 100,
              paused: false,
              speed: 1,
            };
            setSessions((list) => [...list.filter((s) => s.id !== a.sid), session]);
            const view = await withView(a.sid);
            await applyOptions(view, a.options);
            return true;
          }
          case 'mpv.load': {
            const view = await withView(a.sid);
            const headers: string[] = [];
            for (const [k, v] of Object.entries((a.headers ?? {}) as Record<string, string>)) {
              if (k.toLowerCase() === 'user-agent' || k.toLowerCase() === 'referer') continue;
              headers.push(`${k}: ${v}`);
            }
            try {
              await view.setPropertyString('http-header-fields', headers.join(','));
              await view.setPropertyString('user-agent', a.userAgent || 'VLC/3.0.20 LibVLC/3.0.20');
              await view.setPropertyString('referrer', a.referer || '');
            } catch {
              /* headers are best effort */
            }
            patch(a.sid, { source: a.url, startPosition: a.startPosition ?? 0 });
            return true;
          }
          case 'mpv.bounds':
            patch(a.sid, { bounds: a.bounds });
            return true;
          case 'mpv.paused':
            patch(a.sid, { paused: !!a.paused });
            return true;
          case 'mpv.volume':
            patch(a.sid, { volume: a.volume });
            return true;
          case 'mpv.speed':
            patch(a.sid, { speed: a.speed });
            return true;
          case 'mpv.seek':
            await (await withView(a.sid)).seekTo(a.seconds);
            return true;
          case 'mpv.seekBy':
            await (await withView(a.sid)).seekBy(a.seconds);
            return true;
          case 'mpv.audioTrack':
            await (await withView(a.sid)).setAudioTrack(a.trackId);
            return true;
          case 'mpv.subTrack':
            await (await withView(a.sid)).setSubtitleTrack(a.trackId);
            return true;
          case 'mpv.subDelay':
            await (await withView(a.sid)).setSubtitleDelay(a.seconds);
            return true;
          case 'mpv.prop':
            await (await withView(a.sid)).setPropertyString(a.name, String(a.value));
            return true;
          case 'mpv.addAudio':
            await (await withView(a.sid)).addAudio(a.url, 'select', a.title);
            return true;
          case 'mpv.tracks': {
            const view = await withView(a.sid);
            const [tracks, ids, media] = await Promise.all([
              view.getTrackList(),
              view.getCurrentTrackIds(),
              view.getMediaInfo().catch(() => null),
            ]);
            return { tracks, ids, media };
          }
          case 'mpv.frame': {
            // One picture of the player (mpv screenshot of the decoded video, no subtitles/OSD),
            // optionally cropped to a region (0..1) and scaled down, as raw RGBA for the page's clock OCR.
            const view = await withView(a.sid);
            if (!shotReady.current.has(a.sid)) {
              shotReady.current.add(a.sid);
              try {
                await view.setPropertyString('screenshot-format', 'png');
                await view.setPropertyString('screenshot-png-compression', '1');
              } catch {
                /* the defaults still work */
              }
            }
            const file = `${D7TNative.tempDir()}d7t-frame-${a.sid}.png`;
            const width = Math.max(64, Math.min(1920, Number(a.maxWidth) || 640));
            // mpv has several ways to take a picture; a few of them fail on some builds / decoders, so
            // try them in turn and keep the first that produces a readable file. A command that never
            // answers (a hidden player with nothing to draw) must not block the next try either.
            const within = <T,>(work: Promise<T>, ms: number): Promise<T> =>
              Promise.race([
                work,
                new Promise<T>((_, reject) => setTimeout(() => reject(new Error('no answer from the player')), ms)),
              ]);
            let why = '';
            // The raw route (mpv hands over the pixels itself) comes first: the encoded route
            // (screenshot-to-file) fails on this build, most likely for want of an image encoder.
            const routes: Array<[string, string]> = [
              ['d7t-raw-shot', 'video'],
              ['d7t-raw-shot', 'window'],
              ['screenshot-to-file', 'video'],
              ['screenshot-to-file', 'window'],
            ];
            for (const [route, flag] of routes) {
              try {
                await within(view.setPropertyString('d7t-command', [route, file, flag].join('\u0001')), 4000);
                // The player says whether it really wrote a picture; never read an older file instead.
                const reported = (await within(view.getMediaInfo(), 2000).catch(() => ({}))) as Record<string, unknown>;
                if (reported.d7tLastError) throw new Error(String(reported.d7tLastError));
                return a.region
                  ? await D7TNative.frameCrop(file, a.region.x, a.region.y, a.region.width, a.region.height, width)
                  : await D7TNative.frameRGBA(file, width);
              } catch (error) {
                why = why || `${route} ${flag}: ${String((error as { message?: string })?.message ?? error)}`;
              }
            }
            // Say what the player reported, so a failure explains itself instead of staying blank.
            let detail = '';
            try {
              const info = (await within(view.getMediaInfo(), 2000)) as Record<string, unknown>;
              detail = ` [${String(info.d7tLastError ?? '')} | hwdec=${String(info.hwdecCurrent ?? '')} | ${String(info.width ?? 0)}x${String(info.height ?? 0)}]`;
              if (!shotCopyTried.current.has(a.sid) && !String(info.hwdecCurrent ?? '').includes('copy')) {
                // Zero-copy hardware frames cannot be read back by some mpv builds: decode with copy once.
                shotCopyTried.current.add(a.sid);
                await view.setPropertyString('hwdec', 'videotoolbox-copy').catch(() => undefined);
              }
            } catch {
              /* the reason above is all there is */
            }
            throw new Error(why + detail);
          }
          case 'mpv.info':
            return (await withView(a.sid)).getPlaybackInfo();
          case 'mpv.dispose':
            refs.current.delete(a.sid);
            setSessions((list) => list.filter((s) => s.id !== a.sid));
            return true;
          default:
            throw new Error('unsupported: ' + method);
        }
      },
    }),
    [patch, withView],
  );

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      {sessions.map((s) => {
        const b = s.hidden ? { x: 0, y: 0, width: 2, height: 2 } : s.bounds;
        return (
          <ExpoMpvView
            key={s.id}
            ref={(v) => setRef(s.id, v)}
            style={{ position: 'absolute', left: b.x, top: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) }}
            source={s.source}
            startPosition={s.startPosition}
            paused={s.paused}
            speed={s.speed}
            volume={s.volume}
            hwdec="videotoolbox"
            onLoad={(e) => emit({ sid: s.id, type: 'load', ...e.nativeEvent })}
            onProgress={(e) => emit({ sid: s.id, type: 'progress', ...e.nativeEvent })}
            onPlaybackStateChange={(e) => emit({ sid: s.id, type: 'state', ...e.nativeEvent })}
            onBuffer={(e) => emit({ sid: s.id, type: 'buffer', ...e.nativeEvent })}
            onError={(e) => emit({ sid: s.id, type: 'error', ...e.nativeEvent })}
            onEnd={(e) => emit({ sid: s.id, type: 'end', ...e.nativeEvent })}
          />
        );
      })}
    </View>
  );
});
