import { env } from "@/lib/env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Supprime un objet (sans erreur s'il n'existe pas). */
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

let cached: Storage | undefined;
export function getStorage(): Storage {
  if (cached) return cached;
  const e = env();
  cached =
    e.STORAGE_DRIVER === "s3"
      ? new S3Storage({
          endpoint: e.S3_ENDPOINT!,
          region: e.S3_REGION,
          bucket: e.S3_BUCKET!,
          accessKeyId: e.S3_ACCESS_KEY_ID!,
          secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        })
      : new LocalStorage(e.STORAGE_DIR, e.STORAGE_SECRET);
  return cached;
}
