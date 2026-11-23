import { requireNativeView } from 'expo';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useRef } from 'react';
import { View } from 'react-native';

import { MpvHost, type MpvEvent, type MpvHostHandle } from './src/MpvHost';

type WebViewRef = {
  resolve(id: number, ok: boolean, json: string): Promise<void>;
  emit(event: string, json: string): Promise<void>;
};

const D7TWebView = requireNativeView<any>('D7TNative', 'D7TWebView');

export default function App() {
  const web = useRef<WebViewRef>(null);
  const mpv = useRef<MpvHostHandle>(null);

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
    </View>
  );
}
