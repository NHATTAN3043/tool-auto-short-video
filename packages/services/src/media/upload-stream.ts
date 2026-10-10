import { DomainError } from "@studio/domain";

/** Display name without any directory part a browser or client might send. */
export function displayName(fileName: string): string {
  return fileName.split(/[\\/]/u).at(-1)?.trim() ?? fileName;
}

/** Passes chunks through and fails as soon as the total goes past `maxBytes`. */
export async function* limited(data: AsyncIterable<Uint8Array>, maxBytes: number): AsyncIterable<Uint8Array> {
  let total = 0;
  for await (const chunk of data) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new DomainError("FILE_TOO_LARGE", `File exceeds the limit of ${String(maxBytes)} bytes`);
    }
    yield chunk;
  }
}
