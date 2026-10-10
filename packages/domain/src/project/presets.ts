import type { AutomationMode, AutomationSettings, CaptionStyle, ProjectStyle } from "./schema";

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

export const DEFAULT_MAX_WORDS_PER_SCENE = 18;
