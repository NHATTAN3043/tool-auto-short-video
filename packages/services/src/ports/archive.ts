export interface ArchiveEntry {
  /** Path inside the archive, with `/` separators, e.g. `canh/canh_01.mp4`. */
  name: string;
  /** Absolute path of the file to add. */
  file: string;
}

/** Packs files into one ZIP. The archive appears only once it is complete. */
export interface ArchivePort {
  zip(entries: readonly ArchiveEntry[], absoluteOutput: string): Promise<void>;
}
