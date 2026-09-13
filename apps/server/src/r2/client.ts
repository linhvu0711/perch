export interface R2Client {
  put(key: string, bytes: Uint8Array): Promise<void>;
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array>;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
