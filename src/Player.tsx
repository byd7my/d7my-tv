import { ExpoMpvView, type ExpoMpvViewRef, type MediaInfo } from 'expo-mpv';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import N from '../modules/d7t-native';
import { runAutoSync, type Side, type SyncIO, type SyncStatus } from './autosync';
import type { Channel } from './playlist';
import { C } from './theme';
import { Btn, Card } from './ui';

const SEP = '\u0001';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const info = (i: MediaInfo | null) =>
  i && i.width ? `${i.width}×${i.height} · ${Math.round(i.fps || 0)} fps · ${i.videoCodec || '?'}${i.videoBitrate ? ' · ' + (i.videoBitrate / 1e6).toFixed(1) + ' Mbps' : ''}${i.hwdecCurrent ? ' · HW' : ''}` : '—';
const audioInfo = (i: MediaInfo | null) => (i && i.audioCodec ? `${i.audioCodec}${i.audioBitrate ? ' · ' + Math.round(i.audioBitrate / 1000) + ' kbps' : ''}` : '—');

export default function Player({ picture, sound, onBack }: { picture: Channel; sound: Channel; onBack: () => void }) {
  const pRef = useRef<ExpoMpvViewRef>(null);
  const sRef = useRef<ExpoMpvViewRef>(null);
  const [pInfo, setPInfo] = useState<MediaInfo | null>(null);
  const [sInfo, setSInfo] = useState<MediaInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const wantVideoOnSound = useRef(false);

  const note = useCallback((m: string) => setLog((l) => [m, ...l].slice(0, 5)), []);
  const refOf = (side: Side) => (side === 'picture' ? pRef : sRef);

  // The sound view never decodes video, except while Auto Sync reads its clock.
  const soundVideo = useCallback(() => {
    sRef.current?.setPropertyString('vid', wantVideoOnSound.current ? 'auto' : 'no');
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setTimeout(soundVideo, 300);
    });
    return () => sub.remove();
  }, [soundVideo]);

  useEffect(() => {
    const t = setInterval(async () => {
      try { setPInfo(await pRef.current!.getMediaInfo()); } catch {}
      try { setSInfo(await sRef.current!.getMediaInfo()); } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const tune = (r: React.RefObject<ExpoMpvViewRef | null>) => {
    r.current?.setPropertyString('demuxer-max-bytes', '120MiB');
    r.current?.setPropertyString('demuxer-readahead-secs', '90');
    r.current?.setPropertyString('screenshot-format', 'png');
  };

  /** Hold one side for `seconds` (it then plays on from where it stopped, so it ends up that much later). */
  const hold = useCallback(
    (side: Side, seconds: number) =>
      new Promise<void>((resolve) => {
        const v = refOf(side).current;
        if (!v) return resolve();
        if (seconds < 1) {
          v.setSpeed(0.75); // each second at 0.75x loses 0.25 s
          setTimeout(() => { v.setSpeed(1); resolve(); }, seconds * 4000);
        } else {
          v.pause();
          setTimeout(() => { v.play(); resolve(); }, seconds * 1000);
        }
      }),
    []
  );

  const startSync = async () => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    const dir = N.tempDir();
    const io: SyncIO = {
      shoot: async (side) => {
        const path = `${dir}d7t-${side}.png`;
        const v = refOf(side).current;
        if (!v) return null;
        await v.setPropertyString('d7t-command', ['screenshot-to-file', path, 'video'].join(SEP));
        return path;
      },
      freeze: hold,
      prepare: async () => {
        wantVideoOnSound.current = true;
        soundVideo();
        await sleep(2500);
      },
      finish: async () => {
        wantVideoOnSound.current = false;
        soundVideo();
      },
    };
    await runAutoSync(io, setSync, () => cancelRef.current);
    setRunning(false);
  };

  const manual = (side: Side, s: number) => {
    if (running || paused) return;
    note(`أخّرت ${side === 'picture' ? 'الصورة' : 'الصوت'} ${s} ث`);
    hold(side, s);
  };

  const steps = [0.25, 0.5, 1, 3, 5];

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.videoBox}>
        <ExpoMpvView
          ref={pRef}
          style={StyleSheet.absoluteFill}
          source={picture.url}
          muted
          paused={paused}
          onError={(e) => note('الصورة: ' + e.nativeEvent.error)}
          onLoad={() => { tune(pRef); note('الصورة جاهزة ✓'); }}
        />
        {/* sound instance: 2×2 px, decodes no video */}
        <ExpoMpvView
          ref={sRef}
          style={s.hidden}
          source={sound.url}
          paused={paused}
          onError={(e) => note('الصوت: ' + e.nativeEvent.error)}
          onLoad={() => { tune(sRef); soundVideo(); note('الصوت جاهز ✓'); }}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        <Card>
          <Text style={s.name}>الصورة: {picture.name}</Text>
          <Text style={s.sub}>{info(pInfo)}</Text>
          <Text style={[s.name, { marginTop: 4 }]}>الصوت: {sound.name}</Text>
          <Text style={s.sub}>{audioInfo(sInfo)}</Text>
        </Card>

        <Card>
          <Text style={s.cardTitle}>المزامنة التلقائية</Text>
          <Text style={s.sub}>تقرأ ساعة المباراة من القناتين وتوقف الأسرع لحظات حتى يتطابقا.</Text>
          {sync && <Text style={[s.status, sync.phase === 'failed' && { color: C.danger }, sync.phase === 'done' && { color: C.green }]}>{sync.text}</Text>}
          {running ? (
            <Btn kind="danger" label="إلغاء" onPress={() => { cancelRef.current = true; }} />
          ) : (
            <Btn kind="primary" label="مزامنة تلقائية" onPress={startSync} />
          )}
        </Card>

        <Card>
          <Text style={s.cardTitle}>ضبط يدوي (ثواني)</Text>
          {(['picture', 'sound'] as Side[]).map((side) => (
            <View key={side} style={{ gap: 6 }}>
              <Text style={s.sub}>{side === 'picture' ? 'الصورة متقدمة؟ أخّرها' : 'الصوت متقدم؟ أخّره'}</Text>
              <View style={s.row}>
                {steps.map((d) => <Btn key={d} small label={String(d)} disabled={running} onPress={() => manual(side, d)} />)}
              </View>
            </View>
          ))}
        </Card>

        <View style={s.row}>
          <Btn label="رجوع" kind="danger" onPress={onBack} />
          <Btn label={paused ? 'تشغيل' : 'إيقاف مؤقت'} onPress={() => setPaused((p) => !p)} />
        </View>

        <View>{log.map((l, i) => <Text key={i} style={s.sub}>{l}</Text>)}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.content },
  videoBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  hidden: { position: 'absolute', width: 2, height: 2, opacity: 0.02, left: 0, bottom: 0 },
  name: { color: C.heading, fontSize: 16, textAlign: 'right', fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13, textAlign: 'right' },
  cardTitle: { color: C.heading, fontSize: 17, fontWeight: '700', textAlign: 'right' },
  status: { color: C.accentText, fontSize: 15, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
});
