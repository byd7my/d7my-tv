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
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return parseM3U(await r.text());
}

export async function loadXtream(server: string, user: string, pass: string): Promise<Channel[]> {
  const base = server.replace(/\/+$/, '');
  const q = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  const [catsR, listR] = await Promise.all([
    fetch(`${base}/player_api.php?${q}&action=get_live_categories`),
    fetch(`${base}/player_api.php?${q}&action=get_live_streams`),
  ]);
  if (!listR.ok) throw new Error('HTTP ' + listR.status);
  const cats: Record<string, string> = {};
  try {
    for (const c of await catsR.json()) cats[String(c.category_id)] = c.category_name;
  } catch {}
  const list = await listR.json();
  if (!Array.isArray(list)) throw new Error('رد غير متوقع من السيرفر');
  return list.map((s: any, i: number) => ({
    id: String(s.stream_id ?? i),
    name: String(s.name ?? ''),
    group: cats[String(s.category_id)] ?? '',
    // .m3u8 (HLS) first; most panels serve both
    url: `${base}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${s.stream_id}.m3u8`,
  }));
}
