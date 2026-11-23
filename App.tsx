import { requireNativeView } from 'expo';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type WebViewRef = {
  resolve(id: number, ok: boolean, json: string): Promise<void>;
  emit(event: string, json: string): Promise<void>;
};

const D7TWebView = requireNativeView<{
  ref?: React.Ref<WebViewRef>;
  style?: StyleProp<ViewStyle>;
  onBridge?: (e: { nativeEvent: { json: string } }) => void;
}>('D7TNative', 'D7TWebView');

export default function App() {
  const ref = useRef<WebViewRef>(null);

  // Calls from the page that the phone's JS side answers (native video etc. arrive in later builds).
  const onBridge = useCallback((e: { nativeEvent: { json: string } }) => {
    let msg: { id: number; method: string };
    try {
      msg = JSON.parse(e.nativeEvent.json);
    } catch {
      return;
    }
    ref.current?.resolve(msg.id, false, JSON.stringify('unsupported: ' + msg.method));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#161a22' }}>
      <StatusBar style="light" />
      <D7TWebView ref={ref} style={{ flex: 1 }} onBridge={onBridge} />
    </View>
  );
}
