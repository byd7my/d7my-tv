import N from '../modules/d7t-native';

export const store = {
  get<T>(key: string): T | null {
    try {
      const v = N.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      N.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
