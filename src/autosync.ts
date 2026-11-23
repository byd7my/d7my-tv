/**
 * Automatic sync, same idea as the PC player (split-audio-sync-run.ts):
 * read the match clock off both pictures until the readings are stable, then close the gap with ONE
 * freeze of the side that is ahead, wait for it to settle, and measure again.
 * Lateness is positive when the sound is behind (the picture's clock is further on).
 */
import N from '../modules/d7t-native';
import { locateClockBoxes } from './clock/clock-locator';
import { findClockInText } from './clock/match-clock-text';
import { parseMatchClock } from './clock/match-clock.util';

declare const atob: (s: string) => string;

export type Side = 'picture' | 'sound';
type Region = { x: number; y: number; width: number; height: number };

export const SYNC = {
  tolerance: 0.5,
  windowMs: 10000,
  minReadings: 6,
  inlierBand: 1,
  maxOutlierShare: 0.2,
  maxSpread: 1.5,
  confirmMs: 4000,
  measureTimeoutMs: 60000,
  margin: 0.3,
  settleMs: 10000,
  maxPicture: 30,
  maxSound: 60,
  rounds: 3,
};

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function stable(values: number[]): number | null {
  if (values.length < SYNC.minReadings) return null;
  const med = median(values);
  const inl = values.filter((x) => Math.abs(x - med) <= SYNC.inlierBand);
  if (values.length - inl.length > values.length * SYNC.maxOutlierShare) return null;
  if (inl.length < SYNC.minReadings - 1) return null;
  if (Math.max(...inl) - Math.min(...inl) > SYNC.maxSpread) return null;
  return med;
}

const fixDigits = (t: string) => t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');

async function clockInRegion(path: string, r: Region): Promise<number | null> {
  const res = await N.readText(path, r.x, r.y, r.width, r.height);
  const clock = findClockInText(fixDigits(res.text));
  const parsed = clock ? parseMatchClock(clock) : null;
  return parsed ? parsed.seconds : null;
}

class SideClock {
  region: Region | null = null;
  misses = 0;

  async read(path: string): Promise<number | null> {
    if (this.region) {
      const v = await clockInRegion(path, this.region);
      if (v != null) {
        this.misses = 0;
        return v;
      }
      if (++this.misses < 4) return null;
      this.region = null; // lost: search the frame again
      this.misses = 0;
    }
    const frame = await N.frameRGBA(path, 1280);
    const bin = atob(frame.base64);
    const rgba = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) rgba[i] = bin.charCodeAt(i);
    for (const box of locateClockBoxes(rgba, frame.width, frame.height)) {
      const region = { x: box.x, y: box.y, width: box.width, height: box.height };
      const v = await clockInRegion(path, region);
      if (v != null) {
        this.region = region;
        return v;
      }
    }
    return null;
  }
}

export type SyncStatus = {
  phase: 'searching' | 'measuring' | 'freezing' | 'settling' | 'done' | 'failed' | 'cancelled';
  text: string;
  lateness?: number;
};

export type SyncIO = {
  /** Screenshot of one side's picture (file path), or null. */
  shoot(side: Side): Promise<string | null>;
  /** Hold one side for `seconds`, resolve when it is running again. */
  freeze(side: Side, seconds: number): Promise<void>;
  prepare(): Promise<void>;
  finish(): Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runAutoSync(io: SyncIO, on: (s: SyncStatus) => void, cancelled: () => boolean) {
  const clocks = { picture: new SideClock(), sound: new SideClock() };
  const fmt = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1);
  try {
    await io.prepare();
    let residual = 0;
    for (let round = 1; round <= SYNC.rounds; round++) {
      on({ phase: clocks.picture.region && clocks.sound.region ? 'measuring' : 'searching', text: round === 1 ? 'أبحث عن ساعة المباراة…' : 'أقيس من جديد…' });
      const readings: { at: number; v: number }[] = [];
      const t0 = Date.now();
      let stableSince = 0;
      let gap: number | null = null;
      while (Date.now() - t0 < SYNC.measureTimeoutMs) {
        if (cancelled()) return on({ phase: 'cancelled', text: 'أُلغيت المزامنة' });
        const tick = Date.now();
        const [pp, sp] = await Promise.all([io.shoot('picture'), io.shoot('sound')]);
        const [p, s] = await Promise.all([
          pp ? clocks.picture.read(pp).catch(() => null) : Promise.resolve(null),
          sp ? clocks.sound.read(sp).catch(() => null) : Promise.resolve(null),
        ]);
        if (p != null && s != null) readings.push({ at: Date.now(), v: p - s });
        const win = readings.filter((r) => r.at >= Date.now() - SYNC.windowMs).map((r) => r.v);
        const med = stable(win);
        if (med != null) {
          if (!stableSince) stableSince = Date.now();
          on({ phase: 'measuring', text: `الفرق ${fmt(med)} ث (أتأكد…)`, lateness: med });
          if (Date.now() - stableSince >= SYNC.confirmMs) {
            gap = med;
            break;
          }
        } else {
          stableSince = 0;
          const found = `${clocks.picture.region ? '✓' : '…'} الصورة · ${clocks.sound.region ? '✓' : '…'} الصوت`;
          on({ phase: clocks.picture.region && clocks.sound.region ? 'measuring' : 'searching', text: `أقرأ الساعتين ${found}` });
        }
        await sleep(Math.max(0, 1000 - (Date.now() - tick)));
      }
      if (gap == null) return on({ phase: 'failed', text: 'ما قدرت أقرأ ساعة المباراة من القناتين. جرّب قناة تعرض الساعة بوضوح.' });
      residual = gap;
      if (Math.abs(gap) <= SYNC.tolerance) return on({ phase: 'done', text: `تمت المزامنة ✓ (الفرق ${fmt(gap)} ث)`, lateness: gap });
      const side: Side = gap > 0 ? 'picture' : 'sound';
      const seconds = Math.max(0.3, Math.abs(gap) - SYNC.margin);
      if (seconds > (side === 'picture' ? SYNC.maxPicture : SYNC.maxSound)) {
        return on({ phase: 'failed', text: `الفرق ${fmt(gap)} ث أكبر من أن يُعالج تلقائياً`, lateness: gap });
      }
      on({ phase: 'freezing', text: `أوقف ${side === 'picture' ? 'الصورة' : 'الصوت'} ${seconds.toFixed(1)} ث`, lateness: gap });
      await io.freeze(side, seconds);
      on({ phase: 'settling', text: 'أنتظر الاستقرار…', lateness: gap });
      for (let i = 0; i < SYNC.settleMs / 500; i++) {
        if (cancelled()) return on({ phase: 'cancelled', text: 'أُلغيت المزامنة' });
        await sleep(500);
      }
    }
    on({ phase: 'failed', text: `بقي فرق ${fmt(residual)} ث بعد ${SYNC.rounds} محاولات`, lateness: residual });
  } catch (e: any) {
    on({ phase: 'failed', text: 'تعذرت المزامنة: ' + String(e?.message ?? e) });
  } finally {
    await io.finish();
  }
}
