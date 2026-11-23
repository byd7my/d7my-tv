import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Player from './src/Player';
import { Channel, loadM3U, loadXtream } from './src/playlist';
import { store } from './src/store';
import { C } from './src/theme';
import { Btn, Card, Pill } from './src/ui';

type Source = { mode: 'm3u' | 'xtream'; m3u: string; srv: string; usr: string; pwd: string };
type Pick = 'picture' | 'sound';

const EMPTY: Source = { mode: 'xtream', m3u: '', srv: '', usr: '', pwd: '' };

const initials = (n: string) => {
  const w = n.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '?') + (w[1]?.[0] ?? '')).toUpperCase();
};
const tint = (n: string) => {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return `hsl(${h}, 28%, 30%)`;
};

export default function App() {
  const [src, setSrc] = useState<Source>(() => store.get<Source>('source') ?? EMPTY);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Pick>('picture');
  const [pic, setPic] = useState<Channel | null>(null);
  const [snd, setSnd] = useState<Channel | null>(null);
  const [playing, setPlaying] = useState(false);

  const patch = (p: Partial<Source>) => setSrc((o) => ({ ...o, ...p }));

  const connect = useCallback(async (s: Source) => {
    setErr('');
    setLoading(true);
    try {
      const list = s.mode === 'm3u' ? await loadM3U(s.m3u.trim()) : await loadXtream(s.srv, s.usr.trim(), s.pwd.trim());
      if (!list.length) throw new Error('القائمة فاضية');
      setChannels(list);
      setCat(null);
      store.set('source', s);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = store.get<Source>('source');
    if (saved && (saved.m3u || saved.srv)) connect(saved);
  }, [connect]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of channels) m.set(c.group || 'بدون فئة', (m.get(c.group || 'بدون فئة') ?? 0) + 1);
    return [...m.entries()];
  }, [channels]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    let base = channels;
    if (cat) base = base.filter((c) => (c.group || 'بدون فئة') === cat);
    if (t) base = base.filter((c) => c.name.toLowerCase().includes(t));
    return base.slice(0, 300);
  }, [channels, cat, q]);

  if (playing && pic && snd) return <Player picture={pic} sound={snd} onBack={() => setPlaying(false)} />;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {!channels.length ? (
          <ScrollView contentContainerStyle={s.setup} keyboardShouldPersistTaps="handled">
            <Image source={require('./assets/logo.png')} style={s.logoBig} />
            <Text style={s.title}>D7T</Text>
            <Text style={s.tagline}>صورة من قناة وصوت من قناة ثانية</Text>
            <Card style={{ alignSelf: 'stretch' }}>
              <View style={s.seg}>
                <Pill label="Xtream" active={src.mode === 'xtream'} onPress={() => patch({ mode: 'xtream' })} />
                <Pill label="رابط M3U" active={src.mode === 'm3u'} onPress={() => patch({ mode: 'm3u' })} />
              </View>
              {src.mode === 'm3u' ? (
                <Field ph="https://example.com/playlist.m3u" v={src.m3u} on={(v) => patch({ m3u: v })} />
              ) : (
                <>
                  <Field ph="http://server:port" v={src.srv} on={(v) => patch({ srv: v })} />
                  <Field ph="اسم المستخدم" v={src.usr} on={(v) => patch({ usr: v })} />
                  <Field ph="كلمة المرور" v={src.pwd} on={(v) => patch({ pwd: v })} secure />
                </>
              )}
              {!!err && <Text style={s.err}>{err}</Text>}
              {loading ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 12 }} /> : <Btn kind="primary" label="تحميل القنوات" onPress={() => connect(src)} />}
            </Card>
          </ScrollView>
        ) : (
          <>
            <View style={s.header}>
              <Btn small label="تغيير المصدر" onPress={() => { setChannels([]); setPic(null); setSnd(null); }} />
              <View style={{ flex: 1 }} />
              <Text style={s.headTitle}>D7T</Text>
              <Image source={require('./assets/logo.png')} style={s.logoSmall} />
            </View>

            <View style={s.split}>
              <Tile label="الصورة من" ch={pic} active={pick === 'picture'} onPress={() => setPick('picture')} />
              <Tile label="الصوت من" ch={snd} active={pick === 'sound'} onPress={() => setPick('sound')} />
            </View>

            <TextInput
              style={s.search}
              placeholder="ابحث عن قناة"
              placeholderTextColor={C.muted}
              value={q}
              onChangeText={setQ}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <View style={{ height: 50 }}>
              <FlatList
                horizontal
                inverted
                showsHorizontalScrollIndicator={false}
                data={[['', channels.length] as [string, number], ...cats]}
                keyExtractor={(c) => c[0] || '__all'}
                contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}
                renderItem={({ item }) => (
                  <Pill label={item[0] || 'الكل'} count={item[1]} active={(cat ?? '') === item[0]} onPress={() => setCat(item[0] || null)} />
                )}
              />
            </View>

            <FlatList
              data={shown}
              keyExtractor={(c) => c.id}
              initialNumToRender={20}
              contentContainerStyle={{ paddingBottom: 110, paddingTop: 6 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isP = pic?.id === item.id, isS = snd?.id === item.id;
                return (
                  <Pressable
                    style={[s.row, (isP || isS) && { borderColor: C.accent, backgroundColor: C.accentSoft }]}
                    onPress={() => (pick === 'picture' ? setPic(item) : setSnd(item))}>
                    <View style={[s.avatar, { backgroundColor: tint(item.name) }]}>
                      <Text style={s.avatarText}>{initials(item.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                      {!!item.group && <Text style={s.rowSub} numberOfLines={1}>{item.group}</Text>}
                    </View>
                    {(isP || isS) && <Text style={s.badge}>{isP && isS ? 'صورة + صوت' : isP ? 'صورة' : 'صوت'}</Text>}
                  </Pressable>
                );
              }}
            />

            <View style={s.dock} pointerEvents="box-none">
              <Btn kind="primary" label="تشغيل" disabled={!(pic && snd)} onPress={() => setPlaying(true)} style={{ alignSelf: 'stretch' }} />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(p: { ph: string; v: string; on: (v: string) => void; secure?: boolean }) {
  return (
    <TextInput
      style={s.input}
      placeholder={p.ph}
      placeholderTextColor={C.muted}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={p.secure}
      value={p.v}
      onChangeText={p.on}
    />
  );
}

function Tile(p: { label: string; ch: Channel | null; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={[s.tile, p.active && { borderColor: C.accent, backgroundColor: C.accentSoft }]}>
      <Text style={s.tileLabel}>{p.label}</Text>
      <Text style={s.tileName} numberOfLines={1}>{p.ch?.name ?? 'اختر قناة'}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.content },
  setup: { padding: 20, alignItems: 'center', gap: 12, paddingTop: 48 },
  logoBig: { width: 96, height: 96, borderRadius: 22 },
  logoSmall: { width: 34, height: 34, borderRadius: 8 },
  title: { color: C.heading, fontSize: 30, fontWeight: '700' },
  tagline: { color: C.muted, fontSize: 15, marginBottom: 8 },
  seg: { flexDirection: 'row-reverse', gap: 8, justifyContent: 'center' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)', color: C.heading, borderRadius: 12,
    borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 11,
    textAlign: 'right', fontSize: 16,
  },
  err: { color: C.danger, textAlign: 'right', fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.rail },
  headTitle: { color: C.heading, fontSize: 20, fontWeight: '700' },
  split: { flexDirection: 'row-reverse', gap: 10, padding: 12 },
  tile: { flex: 1, backgroundColor: C.widget, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 12, gap: 2 },
  tileLabel: { color: C.muted, fontSize: 12, textAlign: 'right' },
  tileName: { color: C.heading, fontSize: 15, fontWeight: '600', textAlign: 'right' },
  search: {
    marginHorizontal: 12, marginBottom: 8, backgroundColor: C.widget, color: C.heading, borderRadius: 14,
    borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 10, textAlign: 'right', fontSize: 16,
  },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginHorizontal: 12, marginVertical: 3,
    padding: 10, borderRadius: 16, borderWidth: 1, borderColor: 'transparent', backgroundColor: C.widget,
  },
  avatar: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.heading, fontWeight: '700', fontSize: 15 },
  rowName: { color: C.heading, fontSize: 16, textAlign: 'right', fontWeight: '600' },
  rowSub: { color: C.muted, fontSize: 13, textAlign: 'right' },
  badge: { color: C.accentText, fontSize: 12 },
  dock: { position: 'absolute', left: 14, right: 14, bottom: 18 },
});
