import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { C } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn(p: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kind = p.kind ?? 'ghost';
  return (
    <Pressable
      disabled={p.disabled}
      onPress={p.onPress}
      style={({ pressed }) => [
        s.btn,
        p.small && s.btnSmall,
        kind === 'primary' && { backgroundColor: C.accent, borderColor: C.accent },
        kind === 'danger' && { borderColor: C.danger },
        p.disabled && { opacity: 0.35 },
        pressed && { opacity: 0.65 },
        p.style,
      ]}>
      <Text
        style={[
          s.btnText,
          p.small && { fontSize: 14 },
          kind === 'primary' && { color: C.onAccent },
          kind === 'danger' && { color: C.danger },
        ]}>
        {p.label}
      </Text>
    </Pressable>
  );
}

export function Pill(p: { label: string; count?: number; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={[s.pill, p.active && s.pillActive]}>
      <Text style={[s.pillText, p.active && { color: C.accentText }]} numberOfLines={1}>
        {p.label}
      </Text>
      {p.count != null && <Text style={[s.pillCount, p.active && { color: C.accentText }]}>{p.count}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.widget,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    gap: 10,
  },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: C.lineStrong,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  btnText: { color: C.heading, fontSize: 16, fontWeight: '600' },
  pill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pillActive: { backgroundColor: C.accentSoft, borderColor: C.accent },
  pillText: { color: C.heading, fontSize: 14, maxWidth: 160 },
  pillCount: { color: C.muted, fontSize: 12 },
});
