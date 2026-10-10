/**
 * Binary file storage. A key is a POSIX path relative to the storage root, e.g.
 * `projects/prj_1/media/ast_2.mp4`. Keys that would escape the root are rejected.
 */
export interface StoragePort {
  /** Streams data to `key` atomically (no half-written file on failure) and reports size and sha256. */
  write(key: string, data: AsyncIterable<Uint8Array>): Promise<{ bytes: number; sha256: string }>;
  /** Absolute path for tools that need a real file (ffprobe). */
  resolvePath(key: string): string;
  /** Absolute path whose parent directory exists, for tools that write a file themselves (ffmpeg). */
  pathForWrite(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  /** Size of a regular file, or null when there is no file at `key`. */
  stat(key: string): Promise<{ size: number } | null>;
  /** Streams the file, or the inclusive byte range `start..end` of it. */
  read(key: string, range?: { start: number; end: number }): AsyncIterable<Uint8Array>;
  /** No-op when the key does not exist. */
  remove(key: string): Promise<void>;
  /** Removes a folder and everything below it; no-op when it does not exist. */
  removeFolder(key: string): Promise<void>;
}
