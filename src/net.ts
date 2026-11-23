import N from '../modules/d7t-native';

/** GET text. http:// goes through a raw socket (no App Transport Security), https:// through fetch. */
export async function getText(url: string, timeoutSeconds = 30): Promise<string> {
  let cur = url;
  for (let hops = 0; hops < 6; hops++) {
    if (cur.toLowerCase().startsWith('https://')) {
      const r = await fetch(cur);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    }
    const r = await N.httpGet(cur, timeoutSeconds);
    if (r.status >= 300 && r.status < 400 && r.location) {
      cur = new URL(r.location, cur).toString();
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
    return r.body;
  }
  throw new Error('تحويلات كثيرة');
}
