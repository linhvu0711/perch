export interface XClient {}

export interface FakeXClient extends XClient {
  calls: Array<{ name: string; args: unknown[] }>;
}

export function fakeXClient(): FakeXClient {
  return { calls: [] };
}
