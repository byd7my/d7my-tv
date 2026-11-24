import { requireNativeView } from 'expo';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { MpvHost, type MpvEvent, type MpvHostHandle } from './src/MpvHost';

type WebViewRef = {
  resolve(id: number, ok: boolean, json: string): Promise<void>;
  emit(event: string, json: string): Promise<void>;
};

const D7TWebView = requireNativeView<any>('D7TNative', 'D7TWebView');
const D7TTabBar = requireNativeView<any>('D7TNative', 'D7TTabBarView');

// Lume's tab order: Search, Home, Movies, Series, Live TV, then the last place (More). A tab with
// no icon is text only, as in Lume.
const TABS = [
  { id: 'search', title: 'Search', icon: 'magnifyingglass' },
  { id: 'home', title: 'Home' },
  { id: 'movies', title: 'Movies' },
  { id: 'series', title: 'Series' },
  { id: 'live', title: 'Live TV' },
  { id: 'more', title: 'More', icon: 'ellipsis' },
];

export default function App() {
  const web = useRef<WebViewRef>(null);
  const mpv = useRef<MpvHostHandle>(null);
  const [tab, setTab] = useState({ active: 'home', hidden: false, ready: false });

  const emit = useCallback((event: MpvEvent) => {
    web.current?.emit('mpv', JSON.stringify(event)).catch(() => undefined);
  }, []);

  // Calls the page makes that the phone's JS side answers (the native players).
  const onBridge = useCallback(async (e: { nativeEvent: { json: string } }) => {
    let msg: { id: number; method: string; args: Record<string, unknown> };
    try {
      msg = JSON.parse(e.nativeEvent.json);
    } catch {
      return;
    }
    try {
      // The page says which tab is showing and whether the bar must be out of the way (fullscreen).
      if (msg.method === 'tabs.state') {
        const a = msg.args as { active?: string; hidden?: boolean };
        setTab({ active: a.active ?? 'home', hidden: !!a.hidden, ready: true });
        await web.current?.resolve(msg.id, true, 'null');
        return;
      }
      if (!msg.method.startsWith('mpv.') || !mpv.current) throw new Error('unsupported: ' + msg.method);
      const result = await mpv.current.call(msg.method, (msg.args ?? {}) as Record<string, any>);
      await web.current?.resolve(msg.id, true, JSON.stringify(result ?? null));
    } catch (err) {
      await web.current?.resolve(msg.id, false, JSON.stringify(String((err as Error)?.message ?? err)));
    }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0d0f12' }}>
      <StatusBar style="light" />
      <MpvHost ref={mpv} emit={emit} />
      <D7TWebView ref={web} style={{ flex: 1 }} onBridge={onBridge} />
      {tab.ready && (
        <D7TTabBar
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          pointerEvents="box-none"
          tabs={TABS}
          selected={tab.active}
          barHidden={tab.hidden}
          onSelectTab={(e: { nativeEvent: { id: string } }) => {
            web.current?.emit('tab', JSON.stringify(e.nativeEvent.id)).catch(() => undefined);
          }}
        />
      )}
    </View>
  );
}
