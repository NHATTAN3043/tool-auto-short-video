import type {
  MediaRankRequest,
  RankCandidate,
  ScenePlanRequest,
  SceneRewriteRequest,
  ScriptRequest,
  VisualPlan,
  VisualPlanRequest,
} from "@studio/domain";
import { z } from "zod";

// Prompts and the output shapes asked from Claude. The shapes stay plain (no length limits) because
// structured outputs support only part of JSON Schema; the domain normalizes the answer afterwards.

const PreferredMediaSchema = z.enum(["video", "image"]);

export const ScriptOutputSchema = z.object({
  title: z.string().describe("Tiêu đề ngắn cho video"),
  script: z.string().describe("Lời đọc, mỗi đoạn là một cảnh, các đoạn cách nhau bằng một dòng trống"),
});

const VisualFields = {
  intent: z.string().describe("Ý đồ hình ảnh của cảnh, bằng tiếng Việt, một câu"),
  preferredMedia: PreferredMediaSchema,
  searchQueries: z
    .array(z.string())
    .describe("3-6 cụm từ khoá TIẾNG ANH để tìm video/ảnh stock (Pexels, Pixabay), cụ thể, dễ quay"),
  searchQueriesVi: z.array(z.string()).describe("3-6 cụm từ khoá TIẾNG VIỆT cùng ý, để tìm hình"),
  searchQueriesZh: z
    .array(z.string())
    .describe("3-6 cụm từ khoá TIẾNG TRUNG (giản thể) cùng ý, để tìm trên Douyin, Baidu…"),
};

/** The flat fields Claude returns → the domain's visual plan. */
export function toVisualPlan(fields: {
  intent: string;
  preferredMedia: "video" | "image";
  searchQueries: string[];
  searchQueriesVi: string[];
  searchQueriesZh: string[];
}): VisualPlan {
  return {
    intent: fields.intent,
    preferredMedia: fields.preferredMedia,
    searchQueries: fields.searchQueries,
    localizedQueries: { vi: fields.searchQueriesVi, zh: fields.searchQueriesZh },
  };
}

export const ScenesOutputSchema = z.object({
  scenes: z.array(z.object({ narration: z.string(), ...VisualFields })),
});

export const VisualOutputSchema = z.object({
  plans: z.array(z.object({ sceneNumber: z.number().int(), ...VisualFields })),
});

export const SYSTEM_PROMPT = [
  "Bạn là biên kịch video dọc ngắn (TikTok, YouTube Shorts, Facebook Reels) cho khán giả Việt Nam.",
  "Viết tiếng Việt tự nhiên, câu ngắn, dễ đọc thành tiếng; 3 giây đầu phải có câu móc (hook) gây tò mò.",
  "Không dùng emoji, hashtag, ký hiệu markdown hay chỉ dẫn sân khấu trong lời đọc.",
  "Từ khoá tìm hình mô tả thứ quay được (vật, người, hành động, bối cảnh), không trừu tượng.",
  "Mỗi cảnh cần ít nhất 3 từ khoá cho MỖI thứ tiếng: tiếng Anh, tiếng Việt và tiếng Trung giản thể.",
].join("\n");

export function scriptPrompt(input: ScriptRequest): string {
  const words = Math.round(input.targetDurationSec * 2.6);
  return [
    `Viết lời đọc cho một video dọc dài khoảng ${String(input.targetDurationSec)} giây (khoảng ${String(words)} từ).`,
    input.tone ? `Giọng văn: ${input.tone}.` : "",
    "Chia thành các đoạn ngắn, mỗi đoạn là một cảnh (1-2 câu), cách nhau bằng một dòng trống.",
    "Kết thúc bằng một câu kêu gọi nhẹ nhàng (theo dõi, bình luận…).",
    "",
    "Ý tưởng:",
    input.idea,
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

export function scenesPrompt(input: ScenePlanRequest): string {
  return [
    `Chia script dưới đây thành các cảnh, mỗi cảnh tối đa ${String(input.maxWordsPerScene)} từ, ngắt ở chỗ tự nhiên.`,
    "Giữ nguyên lời gốc: không thêm, bớt hay sửa chữ; chỉ chia đoạn.",
    "Với mỗi cảnh, đề xuất ý đồ hình ảnh, loại media nên dùng (video hay ảnh) và từ khoá tìm hình",
    "bằng tiếng Anh, tiếng Việt và tiếng Trung (mỗi thứ tiếng ít nhất 3 từ khoá).",
    "",
    "Script:",
    input.script,
  ].join("\n");
}

export function visualPrompt(input: VisualPlanRequest): string {
  const scenes = input.scenes.map((scene, index) => `Cảnh ${String(index + 1)}: ${scene.narration}`);
  return [
    "Đề xuất hình ảnh cho từng cảnh dưới đây: ý đồ hình ảnh, loại media nên dùng và từ khoá tìm hình",
    "bằng tiếng Anh, tiếng Việt và tiếng Trung (mỗi thứ tiếng ít nhất 3 từ khoá).",
    "Trả về đúng một mục cho mỗi cảnh, `sceneNumber` là số thứ tự cảnh.",
    input.script.trim() === "" ? "" : `\nToàn bộ script để hiểu ngữ cảnh:\n${input.script}\n`,
    ...scenes,
  ].join("\n");
}

// Numbers instead of keys: models copy long ids badly. The adapter maps them back.
export const RankOutputSchema = z.object({
  scenes: z.array(
    z.object({
      sceneNumber: z.number().int(),
      ranking: z
        .array(z.number().int())
        .describe("Số thứ tự các ứng viên của cảnh, phù hợp nhất đứng trước, đủ mọi ứng viên"),
    }),
  ),
});

export const RewriteOutputSchema = z.object({
  narration: z.string().describe("Lời đọc mới của cảnh, chỉ lời đọc"),
});

function seconds(ms: number): string {
  return `${String(Math.round(ms / 100) / 10).replace(".", ",")} giây`;
}

/** `video dọc 1080×1920, 8 giây · mô tả: cat, kitten` */
export function candidateLine(candidate: RankCandidate): string {
  const orientation =
    candidate.height > candidate.width ? "dọc" : candidate.height < candidate.width ? "ngang" : "vuông";
  const parts = [
    `${candidate.kind === "video" ? "video" : "ảnh"} ${orientation} ${String(candidate.width)}×${String(candidate.height)}`,
  ];
  if (candidate.durationMs !== undefined) parts.push(seconds(candidate.durationMs));
  if (candidate.description !== undefined && candidate.description.trim() !== "") {
    parts.push(`mô tả: ${candidate.description.trim()}`);
  }
  return parts.join(" · ");
}

export const RANK_INTRO = [
  "Xếp hạng media cho từng cảnh của một video dọc 9:16: ứng viên hợp với lời đọc và ý đồ hình ảnh nhất đứng đầu.",
  "Ưu tiên nội dung khớp lời đọc, rồi tới khung dọc, rồi chất lượng hình. Đánh số theo đúng số thứ tự đã cho.",
].join("\n");

/** One scene of a ranking request; in vision mode each candidate's image follows its line. */
export function rankSceneHeader(scene: MediaRankRequest["scenes"][number], index: number): string {
  const intent = scene.intent ? `\nÝ đồ hình ảnh: ${scene.intent}` : "";
  return `\nCảnh ${String(index + 1)}: ${scene.narration}${intent}`;
}

export const candidateLabel = (candidate: RankCandidate, index: number) =>
  `Ứng viên ${String(index + 1)}: ${candidateLine(candidate)}`;

/** The whole ranking request as text: candidates are described, not shown. */
export function rankPrompt(input: MediaRankRequest): string {
  return [
    RANK_INTRO,
    ...input.scenes.map((scene, index) =>
      [rankSceneHeader(scene, index), ...scene.candidates.map(candidateLabel)].join("\n"),
    ),
  ].join("\n");
}

export function rewritePrompt(input: SceneRewriteRequest): string {
  return [
    "Viết lại lời đọc của MỘT cảnh trong video dọc, giữ ý chính và độ dài tương đương, đọc thành tiếng tự nhiên.",
    input.instruction ? `Yêu cầu thêm: ${input.instruction}.` : "",
    input.script.trim() === "" ? "" : `\nToàn bộ script để hiểu ngữ cảnh:\n${input.script}\n`,
    "Lời đọc hiện tại của cảnh:",
    input.narration,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
