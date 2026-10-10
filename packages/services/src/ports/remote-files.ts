export interface RemoteFile {
  /** 200 or 206; anything else is thrown. */
  status: number;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  body: AsyncIterable<Uint8Array>;
}

/** Reads a public HTTPS file (stock download, thumbnail or preview). */
export interface RemoteFilePort {
  /** `range` is passed through as the HTTP Range header, for video seeking. */
  open(url: string, options?: { range?: string | null }): Promise<RemoteFile>;
}
