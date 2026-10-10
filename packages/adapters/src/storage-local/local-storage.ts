import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { DomainError, isDomainError } from "@studio/domain";
import type { StoragePort } from "@studio/services";

/** Files on the local disk under one root directory (STUDIO_STORAGE_DIR). */
export class LocalStorage implements StoragePort {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  resolvePath(key: string): string {
    // Keys are POSIX paths; a backslash is only a separator on Windows, so reject it everywhere.
    if (key === "" || /[\0\\]/u.test(key) || path.isAbsolute(key) || /^[A-Za-z]:/u.test(key)) {
      throw new DomainError("INVALID_INPUT", `Invalid storage key: ${JSON.stringify(key)}`);
    }
    const resolved = path.resolve(this.root, key);
    // The separator matters: "/data/storage-evil" starts with "/data/storage" but is outside it.
    if (!resolved.startsWith(this.root + path.sep)) {
      throw new DomainError("INVALID_INPUT", `Storage key escapes the storage root: ${key}`);
    }
    return resolved;
  }

  async pathForWrite(key: string): Promise<string> {
    const target = this.resolvePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    return target;
  }

  async write(key: string, data: AsyncIterable<Uint8Array>): Promise<{ bytes: number; sha256: string }> {
    const target = await this.pathForWrite(key);
    // Write next to the target and rename, so readers never see a half-written file.
    const temp = `${target}.${randomUUID()}.tmp`;
    const hash = createHash("sha256");
    let bytes = 0;
    async function* counted() {
      for await (const chunk of data) {
        hash.update(chunk);
        bytes += chunk.length;
        yield chunk;
      }
    }
    try {
      await pipeline(Readable.from(counted(), { objectMode: false }), createWriteStream(temp));
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { bytes, sha256: hash.digest("hex") };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolvePath(key));
      return true;
    } catch (error) {
      if (isDomainError(error)) throw error;
      return false;
    }
  }

  async stat(key: string): Promise<{ size: number } | null> {
    const info = await stat(this.resolvePath(key)).catch(() => null);
    return info?.isFile() ? { size: info.size } : null;
  }

  async *read(key: string, range?: { start: number; end: number }): AsyncIterable<Uint8Array> {
    // A generator, so the file is only opened when someone starts reading.
    const file = this.resolvePath(key);
    for await (const chunk of createReadStream(file, range ?? {})) yield chunk as Uint8Array;
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  async removeFolder(key: string): Promise<void> {
    await rm(this.resolvePath(key), { recursive: true, force: true });
  }
}
