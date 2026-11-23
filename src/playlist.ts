import { getText } from './net';

export type Channel = { id: string; name: string; url: string; group: string };

export function parseM3U(text: string): Channel[] {
  const out: Channel[] = [];
  const lines = text.split(/\r?\n/);
  let name = '';
  let group = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('#EXTINF')) {
      const g = /group-title="([^"]*)"/.exec(l);
      group = g ? g[1] : '';
      const c = l.lastIndexOf(',');
      name = c >= 0 ? l.slice(c + 1).trim() : '';
    } else if (!l.startsWith('#')) {
      out.push({ id: String(out.length), name: name || l, url: l, group });
      name = '';
      group = '';
    }
  }
  return out;
}

export async function loadM3U(url: string): Promise<Channel[]> {
  return parseM3U(await getText(url));
}

export async function loadXtream(server: string, user: string, pass: string): Promise<Channel[]> {
  let base = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
  const q = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  const api = `${base}/player_api.php?${q}`;
  const [catsText, listText] = await Promise.all([
    getText(`${api}&action=get_live_categories`).catch(() => '[]'),
    getText(`${api}&action=get_live_streams`, 60),
  ]);
  const cats: Record<string, string> = {};
  try {
    for (const c of JSON.parse(catsText)) cats[String(c.category_id)] = c.category_name;
  } catch {}
  let list: any;
  try {
    list = JSON.parse(listText);
  } catch {
    throw new Error('رد غير متوقع من السيرفر (تأكد من البيانات)');
  }
  if (!Array.isArray(list)) throw new Error('بيانات الدخول غير صحيحة أو الاشتراك منتهي');
  return list.map((s: any, i: number) => ({
    id: String(s.stream_id ?? i),
    name: String(s.name ?? ''),
    group: cats[String(s.category_id)] ?? '',
    url: `${base}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${s.stream_id}.m3u8`,
  }));
}
