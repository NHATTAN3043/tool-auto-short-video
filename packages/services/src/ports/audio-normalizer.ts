/**
 * Evens out the loudness of a speech file so scenes generated one by one play at the same level. Writes a
 * new file; the input is never changed.
 */
export interface AudioNormalizerPort {
  normalize(absoluteInput: string, absoluteOutput: string): Promise<void>;
}
