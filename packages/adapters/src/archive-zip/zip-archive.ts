import { createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import type { ArchiveEntry, ArchivePort } from "@studio/services";
import yazl from "yazl";

/** Relative POSIX path without `..`, drive letters or backslashes, so unzipping stays in its folder. */
function isSafeName(name: string): boolean {
  if (name === "" || name.startsWith("/") || /[\\:\0]/u.test(name)) return false;
  return name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Writes a ZIP with yazl, streaming each file from disk. Media is stored without compression: MP4 and
 * WAV gain little from deflate and storing is much faster. Text files are deflated.
 */
export class ZipArchive implements ArchivePort {
  async zip(entries: readonly ArchiveEntry[], absoluteOutput: string): Promise<void> {
    const names = new Set<string>();
    for (const entry of entries) {
      if (!isSafeName(entry.name)) throw new Error(`Unsafe archive entry name: ${entry.name}`);
      if (names.has(entry.name)) throw new Error(`Duplicate archive entry: ${entry.name}`);
      names.add(entry.name);
    }
    const partial = `${absoluteOutput}.partial`;
    try {
      const zipfile = new yazl.ZipFile();
      for (const entry of entries) {
        // Fails early with a clear error instead of a broken archive.
        await stat(entry.file);
        zipfile.addFile(entry.file, entry.name, { compress: /\.(srt|txt)$/iu.test(entry.name) });
      }
      zipfile.end();
      await pipeline(zipfile.outputStream, createWriteStream(partial));
      await rename(partial, absoluteOutput);
    } finally {
      await rm(partial, { force: true });
    }
  }
}
