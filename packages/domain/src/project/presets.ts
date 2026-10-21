import type {
  AutomationMode,
  AutomationSettings,
  CaptionStyle,
  ProjectStyle,
  Watermark,
  WatermarkCorner,
} from "./schema";

export const MODE_PRESETS: Readonly<Record<AutomationMode, Readonly<AutomationSettings>>> = {
  manual: {
    scriptGeneration: false,
    scenePlanning: false,
    visualKeywords: false,
    voiceGeneration: false,
    mediaSearch: false,
    mediaRanking: false,
    autoMediaSelection: false,
  },
  assisted: {
    scriptGeneration: false,
    scenePlanning: true,
    visualKeywords: true,
    voiceGeneration: true,
    mediaSearch: true,
    mediaRanking: false,
    autoMediaSelection: false,
  },
  full_ai: {
    scriptGeneration: true,
    scenePlanning: true,
    visualKeywords: true,
    voiceGeneration: true,
    mediaSearch: true,
    mediaRanking: true,
    autoMediaSelection: true,
  },
};

export const DEFAULT_CAPTION_STYLE: Readonly<CaptionStyle> = {
  enabled: true,
  positionY: 0.62,
  fontSize: 64,
  maxWordsPerCaption: 6,
  uppercase: false,
  color: "#FFFFFF",
};

export const DEFAULT_PROJECT_STYLE: Readonly<Omit<ProjectStyle, "captions">> = {
  transition: "fade",
  transitionMs: 250,
  background: "#000000",
};

/**
 * Where the logo sits away from each corner. The top stays below the "Following / For You" tabs; the bottom
 * stays above the channel name, the description and the like/comment column of TikTok, Reels and Shorts.
 */
export const WATERMARK_SAFE_OFFSETS: Readonly<Record<WatermarkCorner, { offsetX: number; offsetY: number }>> =
  {
    "top-left": { offsetX: 0.04, offsetY: 0.07 },
    "top-right": { offsetX: 0.04, offsetY: 0.07 },
    "bottom-left": { offsetX: 0.04, offsetY: 0.22 },
    "bottom-right": { offsetX: 0.04, offsetY: 0.22 },
  };

export const DEFAULT_WATERMARK: Readonly<Omit<Watermark, "assetId">> = {
  enabled: true,
  corner: "top-left",
  size: 0.12,
  ...WATERMARK_SAFE_OFFSETS["top-left"],
  opacity: 0.9,
  borderWidth: 4,
  borderColor: "#FFFFFF",
};

export const DEFAULT_MAX_WORDS_PER_SCENE = 18;
