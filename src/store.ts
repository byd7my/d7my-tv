// Settings are kept in memory for the first test build (no extra native module = fewer build risks).
let mem: any = null;
export default {
  async load(): Promise<any | null> { return mem; },
  async save(d: any) { mem = d; },
};
