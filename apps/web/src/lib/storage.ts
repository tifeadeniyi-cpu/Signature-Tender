import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { ObjectStorage } from '@st/core';
import { env } from './env';

const KEY_RE = /^[a-z0-9/_.-]+$/i;
function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

/** Local filesystem storage for development and tests only. Refuses to run in staging or production. */
class LocalStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  private file(key: string) {
    assertKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, body: Uint8Array) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body, { flag: 'wx' }); // never overwrite an existing object
  }
  async get(key: string) {
    return new Uint8Array(await fs.readFile(this.file(key)));
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
}

/** S3-compatible private bucket (Cloudflare R2 in production). Server-side encryption is on by default in R2. */
class S3Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}
  async put(key: string, body: Uint8Array, contentType: string) {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        IfNoneMatch: '*',
      }),
    );
  }
  async get(key: string) {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error('Empty object body');
    return res.Body.transformToByteArray();
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const g = globalThis as unknown as { __stStorage?: ObjectStorage };

export function storage(): ObjectStorage {
  if (g.__stStorage) return g.__stStorage;
  const e = env();
  if (e.STORAGE_DRIVER === 's3') {
    if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY)
      throw new Error('S3 storage is not configured');
    const client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    });
    g.__stStorage = new S3Storage(client, e.S3_BUCKET);
  } else {
    if (e.APP_ENV === 'production' || e.APP_ENV === 'staging')
      throw new Error('Local storage is not allowed in staging or production');
    g.__stStorage = new LocalStorage(e.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), '.storage'));
  }
  return g.__stStorage;
}
