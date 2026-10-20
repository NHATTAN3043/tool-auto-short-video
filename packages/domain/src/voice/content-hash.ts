import { DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from "../text/language";
import { normalizeWhitespace } from "../text/words";
import type { VoiceSettings } from "./schema";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

// FNV-1a 64-bit over UTF-8 bytes: pure JS so the browser can tell outdated voices apart without a request.
// It only detects changes, it is not a security hash.
function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The text actually sent to the TTS provider for a narration. */
export function narrationForSpeech(narration: string): string {
  return normalizeWhitespace(narration);
}

/**
 * Identifies what a generated voice says and how: same narration (ignoring whitespace), same settings and
 * same language give the same hash, so only scenes whose words or voice changed are generated again.
 */
export function voiceContentHash(
  narration: string,
  settings: VoiceSettings,
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
): string {
  const fields: unknown[] = [
    narrationForSpeech(narration),
    settings.provider,
    settings.voiceId,
    settings.modelId,
    settings.stability,
    settings.similarityBoost,
    settings.speed,
  ];
  // Voices made before the project language existed were Vietnamese: leaving the default out keeps
  // their hash, so they are not marked outdated (ADR 0013).
  if (language !== DEFAULT_CONTENT_LANGUAGE) fields.push(language);
  const payload = JSON.stringify(fields);
  return `tts1:${fnv1a64(payload)}`;
}
