import { StatusBar } from 'expo-status-bar';
import { ExpoMpvView, type ExpoMpvViewRef, type MediaInfo } from 'expo-mpv';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorageLite from './src/store';
import { Channel, loadM3U, loadXtream } from './src/playlist';
import { C } from './src/theme';

type Pick = 'video' | 'audio';
type Target = 'video' | 'audio';

function Btn(p: { label: string; onPress: () => void; active?: boolean; small?: boolean; danger?: boolean; disabledLike?: boolean }) {
  return (
    <Pressable
      onPress={p.onPress}
      style={({ pressed }) => [
        s.btn, p.small && s.btnSmall, p.active && { backgroundColor: C.accent, borderColor: C.accent },
        p.danger && { borderColor: C.bad }, p.disabledLike && { opacity: 0.35 }, pressed && { opacity: 0.6 },
      ]}>
      <Text style={[s.btnText, p.small && { fontSize: 14 }]}>{p.label}</Text>
    </Pressable>
  );
}

function fmtInfo(i: MediaInfo | null) {
  if (!i) return '—';
  const br = i.videoBitrate ? ` · ${(i.videoBitrate / 1e6).toFixed(1)} Mbps` : '';
  return `${i.width}×${i.height} @${Math.round(i.fps || 0)} · ${i.videoCodec || '?'}${br} · ${i.hwdecCurrent ? 'HW' : 'SW'}`;
}

export default function App() {
  const [mode, setMode] = useState<'m3u' | 'xtream'>('m3u');
  const [m3u, setM3u] = useState('');
  const [srv, setSrv] = useState('');
  const [usr, setUsr] = useState('');
  const [pwd, setPwd] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Pick>('video');
  const [vch, setVch] = useState<Channel | null>(null);
  const [ach, setAch] = useState<Channel | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    AsyncStorageLite.load().then((d) => {
      if (!d) return;
      setM3u(d.m3u ?? ''); setSrv(d.srv ?? ''); setUsr(d.usr ?? ''); setPwd(d.pwd ?? '');
      if (d.mode) setMode(d.mode);
    });
  }, []);

  const connect = async () => {
    setErr(''); setLoading(true);
    try {
      const list = mode === 'm3u' ? await loadM3U(m3u.trim()) : await loadXtream(srv.trim(), usr.trim(), pwd.trim());
      if (!list.length) throw new Error('القائمة فاضية');
      setChannels(list);
      AsyncStorageLite.save({ mode, m3u, srv, usr, pwd });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t ? channels.filter((c) => c.name.toLowerCase().includes(t) || c.group.toLowerCase().includes(t)) : channels;
    return base.slice(0, 400);
  }, [channels, q]);

  if (playing && vch && ach) {
    return <Player video={vch} audio={ach} onBack={() => setPlaying(false)} />;
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Text style={s.title}>D7T</Text>
        {!channels.length ? (
          <View style={s.card}>
            <View style={s.row}>
              <Btn small label="رابط M3U" active={mode === 'm3u'} onPress={() => setMode('m3u')} />
              <Btn small label="Xtream" active={mode === 'xtream'} onPress={() => setMode('xtream')} />
            </View>
            {mode === 'm3u' ? (
              <TextInput style={s.input} placeholder="https://.../playlist.m3u" placeholderTextColor={C.sub}
                autoCapitalize="none" autoCorrect={false} value={m3u} onChangeText={setM3u} />
            ) : (
              <>
                <TextInput style={s.input} placeholder="http://server:port" placeholderTextColor={C.sub}
                  autoCapitalize="none" autoCorrect={false} value={srv} onChangeText={setSrv} />
                <TextInput style={s.input} placeholder="اسم المستخدم" placeholderTextColor={C.sub}
                  autoCapitalize="none" autoCorrect={false} value={usr} onChangeText={setUsr} />
                <TextInput style={s.input} placeholder="كلمة المرور" placeholderTextColor={C.sub}
                  autoCapitalize="none" autoCorrect={false} secureTextEntry value={pwd} onChangeText={setPwd} />
              </>
            )}
            {!!err && <Text style={{ color: C.bad, textAlign: 'right' }}>{err}</Text>}
            {loading ? <ActivityIndicator color={C.accent} /> : <Btn label="تحميل القنوات" active onPress={connect} />}
          </View>
        ) : (
          <>
            <View style={s.card}>
              <View style={s.row}>
                <Btn small label={`صوت: ${ach?.name ?? '—'}`} active={pick === 'audio'} onPress={() => setPick('audio')} />
                <Btn small label={`فيديو: ${vch?.name ?? '—'}`} active={pick === 'video'} onPress={() => setPick('video')} />
              </View>
              <TextInput style={s.input} placeholder="بحث عن قناة" placeholderTextColor={C.sub}
                value={q} onChangeText={setQ} autoCorrect={false} />
              <View style={s.row}>
                <Btn small label="تغيير القائمة" onPress={() => { setChannels([]); setVch(null); setAch(null); }} />
                <Btn label="تشغيل" active disabledLike={!(vch && ach)} onPress={() => vch && ach && setPlaying(true)} />
              </View>
            </View>
            <FlatList
              data={shown}
              keyExtractor={(c) => c.id}
              initialNumToRender={20}
              renderItem={({ item }) => {
                const isV = vch?.id === item.id, isA = ach?.id === item.id;
                return (
                  <Pressable
                    style={[s.item, (isV || isA) && { borderColor: C.accent }]}
                    onPress={() => (pick === 'video' ? setVch(item) : setAch(item))}>
                    <Text style={s.tag}>{isV ? 'فيديو' : isA ? 'صوت' : ''}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
                      {!!item.group && <Text style={s.itemSub} numberOfLines={1}>{item.group}</Text>}
                    </View>
                  </Pressable>
                );
              }}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Player({ video, audio, onBack }: { video: Channel; audio: Channel; onBack: () => void }) {
  const vRef = useRef<ExpoMpvViewRef>(null);
  const aRef = useRef<ExpoMpvViewRef>(null);
  const [offset, setOffset] = useState(0); // seconds, signed
  const [target, setTarget] = useState<Target>('video');
  const [vInfo, setVInfo] = useState<MediaInfo | null>(null);
  const [aInfo, setAInfo] = useState<MediaInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const note = useCallback((m: string) => setLog((l) => [m, ...l].slice(0, 6)), []);

  // delay is applied on ONE instance via mpv `audio-delay`; the other is reset to 0
  useEffect(() => {
    const on = target === 'video' ? vRef.current : aRef.current;
    const off = target === 'video' ? aRef.current : vRef.current;
    off?.setPropertyString('audio-delay', '0');
    on?.setPropertyString('audio-delay', String(offset));
  }, [offset, target]);

  // audio instance must never decode video; re-assert after returning from background
  const killVideo = useCallback(() => { aRef.current?.setPropertyString('vid', 'no'); }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') setTimeout(killVideo, 300); });
    return () => sub.remove();
  }, [killVideo]);

  useEffect(() => {
    const t = setInterval(async () => {
      try { setVInfo(await vRef.current!.getMediaInfo()); } catch {}
      try { setAInfo(await aRef.current!.getMediaInfo()); } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const nudge = (d: number) => setOffset((o) => Math.round((o + d) * 100) / 100);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.videoBox}>
        <ExpoMpvView
          ref={vRef}
          style={StyleSheet.absoluteFill}
          source={video.url}
          muted
          paused={paused}
          onError={(e) => note('فيديو: ' + e.nativeEvent.error)}
          onLoad={() => note('تحميل الفيديو ✓')}
        />
        {/* audio-only instance: 2×2 px, no video decoded */}
        <ExpoMpvView
          ref={aRef}
          style={s.hidden}
          source={audio.url}
          paused={paused}
          onError={(e) => note('صوت: ' + e.nativeEvent.error)}
          onLoad={() => { killVideo(); note('تحميل الصوت ✓'); }}
        />
      </View>

      <View style={s.card}>
        <Text style={s.itemName}>الفيديو: {video.name}</Text>
        <Text style={s.itemSub}>{fmtInfo(vInfo)}</Text>
        <Text style={[s.itemName, { marginTop: 6 }]}>الصوت: {audio.name}</Text>
        <Text style={s.itemSub}>{aInfo ? `${aInfo.audioCodec || '?'} · ${aInfo.audioBitrate ? Math.round(aInfo.audioBitrate / 1000) + ' kbps' : ''}` : '—'}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.offset}>{offset > 0 ? '+' : ''}{offset.toFixed(2)} ث</Text>
        <View style={s.row}>
          {[-1, -0.25, -0.05].map((d) => <Btn key={d} small label={String(d)} onPress={() => nudge(d)} />)}
          {[0.05, 0.25, 1].map((d) => <Btn key={d} small label={'+' + d} onPress={() => nudge(d)} />)}
        </View>
        <View style={s.row}>
          <Btn small label="صفّر" onPress={() => setOffset(0)} />
          <Btn small label="التأخير على الصوت" active={target === 'audio'} onPress={() => setTarget('audio')} />
          <Btn small label="التأخير على الفيديو" active={target === 'video'} onPress={() => setTarget('video')} />
        </View>
        <View style={s.row}>
          <Btn small label="رجوع" danger onPress={onBack} />
          <Btn small label={paused ? 'تشغيل' : 'إيقاف مؤقت'} onPress={() => setPaused((p) => !p)} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        {log.map((l, i) => <Text key={i} style={s.itemSub}>{l}</Text>)}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 28, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, margin: 12, padding: 12, gap: 10 },
  row: { flexDirection: 'row-reverse', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  input: { backgroundColor: C.cardStrong, color: C.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, textAlign: 'right', fontSize: 16 },
  btn: { backgroundColor: C.cardStrong, borderColor: C.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 8 },
  btnText: { color: C.text, fontSize: 16, fontWeight: '600' },
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginHorizontal: 12, marginVertical: 3, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  itemName: { color: C.text, fontSize: 16, textAlign: 'right' },
  itemSub: { color: C.sub, fontSize: 13, textAlign: 'right' },
  tag: { color: C.accent, fontSize: 13, minWidth: 40, textAlign: 'left' },
  videoBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  hidden: { position: 'absolute', width: 2, height: 2, opacity: 0.02, left: 0, bottom: 0 },
  offset: { color: C.text, fontSize: 36, fontWeight: '700', textAlign: 'center' },
});
