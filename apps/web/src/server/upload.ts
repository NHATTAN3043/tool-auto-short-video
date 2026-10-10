import "server-only";

import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import busboy from "busboy";
import { DomainError } from "@studio/domain";

export interface UploadedFile {
  fileName: string;
  data: AsyncIterable<Uint8Array>;
}

/** Room for the multipart boundaries and headers around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Streams the single file of a multipart/form-data request into `handle` without buffering it in
 * memory. Transport only: what happens to the bytes is the use case's business.
 */
export function receiveSingleFile<T>(
  request: Request,
  maxBytes: number,
  handle: (file: UploadedFile) => Promise<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !request.body) {
    return Promise.reject(new DomainError("INVALID_INPUT", "Expected a multipart/form-data upload"));
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    return Promise.reject(new DomainError("FILE_TOO_LARGE", "Upload is larger than the limit"));
  }

  return new Promise<T>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: { "content-type": contentType },
        // One byte over the limit is enough for the use case to notice and reject the file.
        limits: { files: 1, fileSize: maxBytes + 1, fields: 10 },
        defParamCharset: "utf8",
      });
    } catch {
      reject(new DomainError("INVALID_INPUT", "Malformed multipart request"));
      return;
    }
    const source = Readable.fromWeb(request.body as unknown as NodeWebReadableStream<Uint8Array>);
    let handled = false;
    const settle = (outcome: () => void) => {
      source.unpipe(parser);
      if (!source.readableEnded) source.destroy();
      outcome();
    };

    parser.on("file", (_field, stream, info) => {
      if (handled) {
        stream.resume();
        return;
      }
      handled = true;
      handle({ fileName: info.filename, data: stream }).then(
        (value) => {
          settle(() => {
            resolve(value);
          });
        },
        (error: unknown) => {
          stream.resume();
          settle(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        },
      );
    });
    parser.on("close", () => {
      if (!handled) reject(new DomainError("INVALID_INPUT", "The upload contains no file"));
    });
    parser.on("error", () => {
      if (!handled) reject(new DomainError("INVALID_INPUT", "Malformed multipart request"));
    });
    source.on("error", () => {
      if (!handled) reject(new DomainError("INVALID_INPUT", "Upload was interrupted"));
    });
    source.pipe(parser);
  });
}

/** Turns a lazy byte iterable into a web stream for a Response; cancelling stops the reader. */
export function toWebStream(data: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator: AsyncIterator<Uint8Array, unknown> = data[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done === true) controller.close();
      else controller.enqueue(result.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
