import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import { DEFAULT_MAX_WORDS_PER_SCENE } from "../project/presets";
import { countWords, normalizeWhitespace } from "../text/words";
import type { Scene } from "./schema";
import { splitSentences } from "./split-text";

export type ScriptSplitStrategy = "auto" | "paragraph" | "sentence";

export interface ScriptToScenesOptions {
  /** auto = paragraphs when the script has several blocks, otherwise sentences. */
  strategy?: ScriptSplitStrategy;
  maxWordsPerScene?: number;
}

const DIVIDER_LINE = /^\s*-{3,}\s*$/u;
/** `[Cảnh 2]`, `[Scene 2: intro]`… optionally followed by the narration on the same line. */
const SCENE_MARKER_LINE = /^\s*\[\s*(?:cảnh|canh|scene)[^\]]*\]\s*(.*)$/iu;

/** Splits a script at blank lines, `---` lines and `[Cảnh n]` markers. */
export function splitScriptBlocks(script: string): string[] {
  const blocks: string[][] = [[]];
  const startBlock = () => {
    if (blocks.at(-1)?.length !== 0) blocks.push([]);
  };

  for (const line of script.split(/\r?\n/u)) {
    const marker = SCENE_MARKER_LINE.exec(line);
    if (marker) {
      startBlock();
      blocks.at(-1)?.push(marker[1] ?? "");
    } else if (DIVIDER_LINE.test(line) || line.trim() === "") {
      startBlock();
    } else {
      blocks.at(-1)?.push(line);
    }
  }

  return blocks.map((lines) => normalizeWhitespace(lines.join(" "))).filter((block) => block !== "");
}

/** Greedily joins consecutive sentences while the group stays within `maxWords`. */
export function groupSentences(text: string, maxWords: number): string[] {
  const groups: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const sentence of splitSentences(text)) {
    const words = countWords(sentence);
    if (current.length > 0 && currentWords + words > maxWords) {
      groups.push(current.join(" "));
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += words;
  }
  if (current.length > 0) groups.push(current.join(" "));
  return groups;
}

/** Turns a pasted script into draft scenes without AI. */
export function scriptToScenes(
  script: string,
  options: ScriptToScenesOptions = {},
  ctx: DomainContext = {},
): Scene[] {
  const strategy = options.strategy ?? "auto";
  const maxWords = options.maxWordsPerScene ?? DEFAULT_MAX_WORDS_PER_SCENE;
  if (!Number.isInteger(maxWords) || maxWords < 1) {
    throw new DomainError("INVALID_INPUT", "maxWordsPerScene must be a positive integer");
  }

  const blocks = splitScriptBlocks(script);
  const useParagraphs = strategy === "paragraph" || (strategy === "auto" && blocks.length > 1);
  const narrations = useParagraphs ? blocks : blocks.flatMap((block) => groupSentences(block, maxWords));

  const makeId = ctx.newId ?? newId;
  return narrations.map((narration) => ({ id: makeId("scn"), narration, status: "draft" }));
}
