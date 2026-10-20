"use client";

import type { ContentLanguage, VoiceSettings } from "@studio/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import { projectFileUrl } from "@/features/media/api";

import { previewVoice, voiceSampleUrl } from "../api";
import { previewKey } from "../model";

export type VoicePreviewKind = "sample" | "preview";

const message = (error: unknown) => (error instanceof Error ? error.message : "Không phát được giọng thử.");

/**
 * Plays the provider's free sample of a voice, or a short sentence spoken with the shown settings. One
 * audio element: starting a new clip stops the previous one, leaving the page stops it too.
 */
export function useVoicePreview(projectId: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState<VoicePreviewKind | null>(null);
  const [playing, setPlaying] = useState<VoicePreviewKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Previews made in this session, by content hash: playing one again needs no request.
  const [heard, setHeard] = useState<ReadonlyMap<string, string>>(new Map());

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    async (kind: VoicePreviewKind, url: string) => {
      stop();
      const element = new Audio(url);
      audio.current = element;
      element.onended = () => {
        if (audio.current === element) setPlaying(null);
      };
      setPlaying(kind);
      try {
        await element.play();
      } catch {
        // A missing sample answers 404, which the browser reports as an unsupported source.
        if (audio.current !== element) return;
        audio.current = null;
        setPlaying(null);
        setError(
          kind === "sample"
            ? "Giọng này không có mẫu, hoặc không tải được mẫu."
            : "Không phát được file giọng thử.",
        );
      }
    },
    [stop],
  );

  const playSample = useCallback(
    async (voiceId: string) => {
      setError(null);
      setLoading("sample");
      try {
        await play("sample", voiceSampleUrl(voiceId));
      } catch (cause) {
        setPlaying(null);
        setError(message(cause));
      } finally {
        setLoading(null);
      }
    },
    [play],
  );

  const playPreview = useCallback(
    async (input: { text: string; voice: VoiceSettings; language: ContentLanguage }) => {
      setError(null);
      setLoading("preview");
      try {
        const key = previewKey(input.text, input.voice, input.language);
        let path = heard.get(key);
        if (path === undefined) {
          ({ path } = await previewVoice(projectId, input));
          const stored = path;
          setHeard((previous) => new Map(previous).set(key, stored));
        }
        await play("preview", projectFileUrl(projectId, path));
      } catch (cause) {
        setPlaying(null);
        setError(message(cause));
      } finally {
        setLoading(null);
      }
    },
    [heard, play, projectId],
  );

  const isHeard = useCallback(
    (input: { text: string; voice: VoiceSettings; language: ContentLanguage }) =>
      heard.has(previewKey(input.text, input.voice, input.language)),
    [heard],
  );

  return { loading, playing, error, playSample, playPreview, isHeard, stop };
}

export type VoicePreviewState = ReturnType<typeof useVoicePreview>;
