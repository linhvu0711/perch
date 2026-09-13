import type { R2Client } from './client';

export interface FakeR2Client extends R2Client {
  objects: Map<string, Uint8Array>;
  calls: Array<{ name: string; key: string }>;
  putError: Error | null;
}

export function fakeR2Client(): FakeR2Client {
  const fake: FakeR2Client = {
    objects: new Map(),
    calls: [],
    putError: null,

    async put(key, bytes) {
      fake.calls.push({ name: 'put', key });
      if (fake.putError) throw fake.putError;
      fake.objects.set(key, bytes.slice());
    },
    async list(prefix) {
      fake.calls.push({ name: 'list', key: prefix });
      return [...fake.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    async get(key) {
      fake.calls.push({ name: 'get', key });
      const bytes = fake.objects.get(key);
      if (!bytes) throw new Error(`no object ${key}`);
      return bytes;
    },
  };
  return fake;
}
