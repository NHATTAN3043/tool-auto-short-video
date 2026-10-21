import { DomainError } from "../errors";
import type { MediaAsset } from "../media/schema";
import type { Project, Watermark } from "../project/schema";
import type { SceneMedia } from "../scene/schema";
import { buildCaptions } from "../timeline/captions";
import { computeTimeline } from "../timeline/compute-timeline";
import { activeVoiceTrack } from "../voice/voice-status";
import type {
  RenderPlan,
  RenderPlanAudio,
  RenderPlanMedia,
  RenderPlanScene,
  RenderPlanSfx,
  RenderPlanWatermark,
} from "./types";

/** Maps an asset to a URL the consumer can load: an API route in the web app, a local server in the worker. */
export type ResolveUrl = (asset: MediaAsset) => string;

export function buildRenderPlan(project: Project, resolveUrl: ResolveUrl): RenderPlan {
  const { fps } = project;
  const toFrame = (ms: number) => Math.round((ms / 1000) * fps);
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const getAsset = (assetId: string, expected: readonly MediaAsset["kind"][]): MediaAsset => {
    const asset = assets.get(assetId);
    if (!asset) throw new DomainError("ASSET_NOT_FOUND", `Asset not found: ${assetId}`);
    if (!expected.includes(asset.kind)) {
      throw new DomainError(
        "INVALID_MEDIA",
        `Asset ${assetId} is ${asset.kind}, expected ${expected.join("/")}`,
      );
    }
    return asset;
  };

  const transitionFrames = project.style.transition === "fade" ? toFrame(project.style.transitionMs) : 0;
  const timeline = computeTimeline(project);
  // One narration track only, so a project voice and scene voices never play over each other.
  const voiceTrack = activeVoiceTrack(project);

  // Durations come from rounded boundaries, not rounded per scene, so rounding never accumulates into
  // audio drift. A boundary always advances by at least one frame because Remotion rejects empty sequences.
  const scenes: RenderPlanScene[] = [];
  const voices: RenderPlanAudio[] = [];
  const pendingSfx: { asset: MediaAsset; from: number; volume: number }[] = [];
  let boundary = 0;
  project.scenes.forEach((scene, index) => {
    const entry = timeline[index];
    if (!entry) return;
    const from = boundary;
    boundary = Math.max(toFrame(entry.endMs), from + 1);
    const durationInFrames = boundary - from;
    const isLast = index === project.scenes.length - 1;
    const sequenceDurationInFrames = durationInFrames + (isLast ? 0 : transitionFrames);

    const planScene: RenderPlanScene = {
      sceneId: scene.id,
      index,
      from,
      durationInFrames,
      sequenceDurationInFrames,
      durationSource: entry.source,
    };
    if (scene.media) planScene.media = planMedia(scene.media, sequenceDurationInFrames);
    scenes.push(planScene);

    if (voiceTrack === "scenes" && scene.voiceAssetId !== undefined) {
      voices.push({ src: resolveUrl(getAsset(scene.voiceAssetId, ["audio"])), from, durationInFrames });
    }
    for (const effect of scene.sfx ?? []) {
      pendingSfx.push({
        asset: getAsset(effect.assetId, ["audio"]),
        from: from + toFrame(effect.offsetMs),
        volume: effect.volume,
      });
    }
  });
  const durationInFrames = boundary;

  if (voiceTrack === "project" && project.voiceAssetId !== undefined) {
    const voice = getAsset(project.voiceAssetId, ["audio"]);
    const voiceFrames = voice.durationMs === undefined ? durationInFrames : toFrame(voice.durationMs);
    const clipped = Math.min(voiceFrames, durationInFrames);
    if (clipped > 0) voices.unshift({ src: resolveUrl(voice), from: 0, durationInFrames: clipped });
  }

  // Sound effects may ring on past their scene, but never past the end of the video.
  const sfx: RenderPlanSfx[] = pendingSfx.flatMap(({ asset, from, volume }) => {
    const remaining = durationInFrames - from;
    const length =
      asset.durationMs === undefined ? remaining : Math.min(toFrame(asset.durationMs), remaining);
    return length > 0 ? [{ src: resolveUrl(asset), from, durationInFrames: length, volume }] : [];
  });

  const captionStyle = { ...project.style.captions };
  const captions = captionStyle.enabled
    ? buildCaptions(project, timeline)
        .map((caption) => ({
          text: captionStyle.uppercase ? caption.text.toLocaleUpperCase("vi") : caption.text,
          from: toFrame(caption.startMs),
          durationInFrames: toFrame(caption.endMs) - toFrame(caption.startMs),
        }))
        .filter((caption) => caption.durationInFrames > 0)
    : [];

  const plan: RenderPlan = {
    width: project.width,
    height: project.height,
    fps,
    durationInFrames,
    transitionFrames,
    background: project.style.background,
    scenes,
    voices,
    sfx,
    captions,
    captionStyle,
  };
  if (project.music) {
    plan.music = {
      src: resolveUrl(getAsset(project.music.assetId, ["audio"])),
      volume: project.music.volume,
    };
  }
  const watermark = project.style.watermark;
  if (watermark?.enabled && durationInFrames > 0) {
    plan.watermark = placeWatermark(watermark, resolveUrl(getAsset(watermark.assetId, ["image"])), project);
  }
  return plan;

  function planMedia(media: SceneMedia, sequenceFrames: number): RenderPlanMedia {
    const asset = getAsset(media.assetId, ["video", "image"]);
    const src = resolveUrl(asset);
    if (asset.kind === "image") {
      return { kind: "image", src, fit: media.fit, focusX: media.focusX, kenBurns: media.kenBurns };
    }
    const startFrom = toFrame(media.sourceStartMs);
    const endMs = media.sourceEndMs ?? asset.durationMs;
    // Unknown source length: play straight through and trust the file to be long enough.
    const segmentFrames = endMs === undefined ? sequenceFrames : Math.max(1, toFrame(endMs) - startFrom);
    return {
      kind: "video",
      src,
      fit: media.fit,
      focusX: media.focusX,
      volume: media.volume,
      startFrom,
      segmentFrames,
      loop: segmentFrames < sequenceFrames,
    };
  }
}

/** Pixel box of the logo in its corner; the ring is drawn inside the diameter. */
export function placeWatermark(
  watermark: Watermark,
  src: string,
  frame: { width: number; height: number },
): RenderPlanWatermark {
  const diameter = Math.round(watermark.size * frame.width);
  const marginX = Math.round(watermark.offsetX * frame.width);
  const marginY = Math.round(watermark.offsetY * frame.height);
  const right = watermark.corner.endsWith("right");
  const bottom = watermark.corner.startsWith("bottom");
  return {
    src,
    left: right ? frame.width - marginX - diameter : marginX,
    top: bottom ? frame.height - marginY - diameter : marginY,
    diameter,
    opacity: watermark.opacity,
    borderWidth: watermark.borderWidth,
    borderColor: watermark.borderColor,
  };
}
