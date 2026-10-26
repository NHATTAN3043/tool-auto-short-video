"use client";

import {
  CONTENT_LANGUAGE_LABELS,
  ContentLanguageSchema,
  SkillIdSchema,
  SourceScriptRoleSchema,
  type ContentLanguage,
  type FullAiDraft,
  type MediaAsset,
  type SkillId,
  type SkillSummary,
  type SourcePart,
  type SourceScriptRole,
} from "@studio/domain";
import { useEffect, useId, useState } from "react";

import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

import {
  FULL_AI_DURATIONS,
  parseDuration,
  skillHint,
  sourceDurations,
  sourceSeconds,
  withSourceVideo,
} from "../model";
import { RankingModePicker } from "./RankingModePicker";

const NO_SKILL = "none";
const MONTAGE = "montage";
const SOURCE = "source";
const CUSTOM_DURATION = "custom";
/** Original audio kept under the narration when the user turns it on. */
const DEFAULT_SOURCE_VOLUME = 0.2;

const SCRIPT_ROLES: Record<SourceScriptRole, { label: string; hint: string }> = {
  reference: {
    label: "Thoại / sub gốc của video",
    hint: "AI đọc để hiểu video đang nói gì, rồi viết lời kể mới bám theo.",
  },
  narration: {
    label: "Lời đọc của tôi, giữ nguyên",
    hint: "AI giữ nguyên câu chữ (chỉ bỏ bớt câu khi video không đủ dài) và đặt từng câu vào khúc hình khớp.",
  },
};

const PART_NONE = "none";
const PART_SOURCE = "source";
const ASSET_PREFIX = "asset:";

/** Where the hook or the ending of a source run comes from: nothing, the source video, or a project file. */
function PartPicker({
  id,
  label,
  sourceLabel,
  value,
  clips,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  sourceLabel: string;
  value: SourcePart | undefined;
  clips: readonly MediaAsset[];
  disabled: boolean;
  onChange: (part: SourcePart) => void;
}) {
  const selected = value?.kind === "asset" ? `${ASSET_PREFIX}${value.assetId}` : (value?.kind ?? PART_NONE);
  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={selected}
        disabled={disabled}
        onValueChange={(next) => {
          if (next.startsWith(ASSET_PREFIX)) {
            onChange({ kind: "asset", assetId: next.slice(ASSET_PREFIX.length) });
          } else {
            onChange({ kind: next === PART_SOURCE ? "source" : "none" });
          }
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PART_NONE}>Không có</SelectItem>
          <SelectItem value={PART_SOURCE}>{sourceLabel}</SelectItem>
          {clips.map((clip) => (
            <SelectItem key={clip.id} value={`${ASSET_PREFIX}${clip.id}`}>
              {clip.kind === "image" ? "Ảnh" : "Clip"}: {clip.fileName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * First step: the idea and the settings of the run. On a source video (ADR 0020) the run follows that
 * video and the idea, a script or both say what to tell. Otherwise, without "Viết script", the run reads
 * the project's script instead, and only the language, the skill and the ranking mode apply.
 */
export function IdeaStep({
  draft,
  videos,
  clips,
  language,
  askFirst,
  writesScript,
  skills,
  showSkill,
  showRanking,
  disabled,
  onChange,
  onSkillChange,
  onLanguageChange,
  onDurationError,
}: {
  draft: FullAiDraft;
  /** Project videos a run can follow (sourceVideos). */
  videos: readonly MediaAsset[];
  /** Videos and images that can open or close a source run (sourceClips). */
  clips: readonly MediaAsset[];
  language: ContentLanguage;
  askFirst: boolean;
  /** The project's "Viết script" toggle. */
  writesScript: boolean;
  skills: readonly SkillSummary[];
  /** Installed skills exist and a step of this run sends one. */
  showSkill: boolean;
  showRanking: boolean;
  disabled: boolean;
  /** Settings that are always present (the skill is optional, see onSkillChange). */
  onChange: (patch: Partial<Omit<FullAiDraft, "skillId">>) => void;
  onSkillChange: (skillId: SkillId | undefined) => void;
  onLanguageChange: (language: ContentLanguage) => void;
  /** The typed length is not usable (message), or is again (null); the run waits for a valid one. */
  onDurationError: (message: string | null) => void;
}) {
  const ids = {
    idea: useId(),
    language: useId(),
    duration: useId(),
    tone: useId(),
    skill: useId(),
    workflow: useId(),
    source: useId(),
    sourceAudio: useId(),
    sourceVolume: useId(),
    script: useId(),
    scriptRole: useId(),
    customDuration: useId(),
    hook: useId(),
    outro: useId(),
  };
  const skill = skills.find((candidate) => candidate.id === draft.skillId);
  const source = draft.sourceVideo;
  const sourceVideo = source ? videos.find((video) => video.id === source.assetId) : undefined;
  const writesFromIdea = askFirst || source !== undefined;
  const videoSeconds = sourceVideo ? sourceSeconds(sourceVideo) : undefined;
  const durations: readonly number[] =
    videoSeconds === undefined ? FULL_AI_DURATIONS : sourceDurations(videoSeconds);
  const scriptRole = source?.scriptRole ?? "reference";

  // "Tự nhập…": the text as typed; only a valid length reaches the draft, the rest is reported.
  const [typing, setTyping] = useState<string | null>(null);
  const custom = typing !== null || !durations.includes(draft.targetDurationSec);
  const durationText = typing ?? String(draft.targetDurationSec);
  const parsed = custom && writesFromIdea ? parseDuration(durationText) : null;
  const durationError = parsed && "error" in parsed ? parsed.error : null;
  useEffect(() => {
    onDurationError(durationError);
  }, [durationError, onDurationError]);
  const typeDuration = (text: string) => {
    setTyping(text);
    const next = parseDuration(text);
    if ("seconds" in next) onChange({ targetDurationSec: next.seconds });
  };

  const follow = (video: MediaAsset) => {
    onChange({ sourceVideo: withSourceVideo(draft, video).sourceVideo });
  };
  const changeSource = (patch: Partial<NonNullable<FullAiDraft["sourceVideo"]>>) => {
    if (source) onChange({ sourceVideo: { ...source, ...patch } });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.workflow}>Kiểu dựng hình</Label>
          <Select
            value={source ? SOURCE : MONTAGE}
            disabled={disabled}
            onValueChange={(value) => {
              const first = videos[0];
              if (value === MONTAGE) onChange({ sourceVideo: undefined });
              else if (first) follow(first);
            }}
          >
            <SelectTrigger id={ids.workflow}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MONTAGE}>Ghép nhiều media theo từng cảnh</SelectItem>
              <SelectItem value={SOURCE} disabled={videos.length === 0}>
                Bám theo một video nguồn
              </SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {videos.length === 0
              ? "Tải lên dự án một video dài từ 15 giây để kể chuyện bám theo video đó."
              : source
                ? "AI chọn các khúc hay nhất của video, giữ đúng thứ tự gốc, cắt cảnh ở chỗ chuyển cảnh và viết lời kể khớp hình. Không ghép media khác."
                : "AI chia cảnh ngắn rồi tìm hình cho từng cảnh trong kho và Pexels/Pixabay."}
          </span>
        </div>

        {source ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.source}>Video nguồn</Label>
              <Select
                value={source.assetId}
                disabled={disabled}
                onValueChange={(assetId) => {
                  const video = videos.find((candidate) => candidate.id === assetId);
                  if (video) follow(video);
                }}
              >
                <SelectTrigger id={ids.source}>
                  <SelectValue placeholder="Chọn video" />
                </SelectTrigger>
                <SelectContent>
                  {videos.map((video) => (
                    <SelectItem key={video.id} value={video.id}>
                      {video.fileName} ({sourceSeconds(video)} giây)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Video chưa phân tích sẽ được cắt đoạn và mô tả trước khi dựng (tính trong ước tính chi phí).
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm" htmlFor={ids.sourceAudio}>
                <input
                  id={ids.sourceAudio}
                  type="checkbox"
                  checked={source.volume > 0}
                  disabled={disabled}
                  onChange={(event) => {
                    changeSource({ volume: event.target.checked ? DEFAULT_SOURCE_VOLUME : 0 });
                  }}
                />
                Giữ âm thanh gốc
              </label>
              {source.volume > 0 ? (
                <label className="flex items-center gap-2 text-sm" htmlFor={ids.sourceVolume}>
                  Âm lượng {Math.round(source.volume * 100)}%
                  <input
                    id={ids.sourceVolume}
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={Math.round(source.volume * 100)}
                    disabled={disabled}
                    onChange={(event) => {
                      changeSource({ volume: Number(event.target.value) / 100 });
                    }}
                  />
                </label>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.script}>Kịch bản / sub (tuỳ chọn)</Label>
              <Textarea
                id={ids.script}
                rows={5}
                maxLength={20_000}
                disabled={disabled}
                className="bg-background"
                placeholder="Dán thoại, phụ đề hoặc lời đọc của video…"
                value={source.script ?? ""}
                onChange={(event) => {
                  changeSource({ script: event.target.value });
                }}
              />
            </div>
            {(source.script ?? "").trim() !== "" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.scriptRole}>Kịch bản này là</Label>
                <Select
                  value={scriptRole}
                  disabled={disabled}
                  onValueChange={(value) => {
                    changeSource({ scriptRole: SourceScriptRoleSchema.parse(value) });
                  }}
                >
                  <SelectTrigger id={ids.scriptRole}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SourceScriptRoleSchema.options.map((role) => (
                      <SelectItem key={role} value={role}>
                        {SCRIPT_ROLES[role].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">{SCRIPT_ROLES[scriptRole].hint}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-4">
              <PartPicker
                id={ids.hook}
                label="Mở đầu (hook)"
                sourceLabel="Cắt khúc gay cấn từ video gốc"
                value={source.hook}
                clips={clips}
                disabled={disabled}
                onChange={(hook) => {
                  changeSource({ hook });
                }}
              />
              <PartPicker
                id={ids.outro}
                label="Kết (kêu gọi theo dõi)"
                sourceLabel="Cắt khúc cuối từ video gốc"
                value={source.outro}
                clips={clips}
                disabled={disabled}
                onChange={(outro) => {
                  changeSource({ outro });
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Phần chính là một cảnh liền mạch theo video gốc; video tự chạy nhanh/chậm nhẹ (0,8–1,25×) để kết
              thúc cùng giọng đọc.
            </span>
          </>
        ) : null}
      </div>

      {writesFromIdea ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.idea}>{source ? "Yêu cầu cho AI" : "Ý tưởng"}</Label>
          <Textarea
            id={ids.idea}
            rows={3}
            maxLength={2000}
            disabled={disabled}
            className="bg-background"
            placeholder={
              source
                ? "Ví dụ: kể lại hành trình giải cứu chú chó, giọng hồi hộp, kết bằng lời kêu gọi theo dõi"
                : "Ví dụ: 5 sự thật thú vị về loài mèo"
            }
            value={draft.idea}
            onChange={(event) => {
              onChange({ idea: event.target.value });
            }}
          />
        </div>
      ) : !writesScript ? (
        <p className="text-sm text-muted-foreground">
          Dự án đang tắt “Viết script”: Full AI dùng script hiện tại. Bật lại trong cài đặt dự án để AI hỏi
          lại và viết khung kịch bản cho bạn duyệt.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <div className="flex w-36 flex-col gap-1.5">
          <Label htmlFor={ids.language}>Ngôn ngữ lời đọc</Label>
          <Select
            value={language}
            disabled={disabled}
            onValueChange={(value) => {
              onLanguageChange(ContentLanguageSchema.parse(value));
            }}
          >
            <SelectTrigger id={ids.language}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ContentLanguageSchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {CONTENT_LANGUAGE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {writesFromIdea ? (
          <>
            <div className="flex w-36 flex-col gap-1.5">
              <Label htmlFor={ids.duration}>Thời lượng</Label>
              <Select
                value={custom ? CUSTOM_DURATION : String(draft.targetDurationSec)}
                disabled={disabled}
                onValueChange={(value) => {
                  if (value === CUSTOM_DURATION) {
                    setTyping(String(draft.targetDurationSec));
                    return;
                  }
                  setTyping(null);
                  onChange({ targetDurationSec: Number(value) });
                }}
              >
                <SelectTrigger id={ids.duration}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durations.map((seconds) => (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {seconds === videoSeconds
                        ? `Theo video gốc (${String(seconds)} giây)`
                        : `${String(seconds)} giây`}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_DURATION}>Tự nhập…</SelectItem>
                </SelectContent>
              </Select>
              {custom ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={ids.customDuration}
                    inputMode="numeric"
                    aria-label="Số giây"
                    aria-invalid={durationError !== null}
                    disabled={disabled}
                    className="bg-background"
                    value={durationText}
                    onChange={(event) => {
                      typeDuration(event.target.value);
                    }}
                  />
                  <span className="text-sm text-muted-foreground">giây</span>
                </div>
              ) : null}
              {durationError ? <span className="text-xs text-destructive">{durationError}</span> : null}
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor={ids.tone}>Giọng văn (tuỳ chọn)</Label>
              <Input
                id={ids.tone}
                maxLength={200}
                disabled={disabled}
                className="bg-background"
                placeholder="hài hước, truyền cảm hứng…"
                value={draft.tone}
                onChange={(event) => {
                  onChange({ tone: event.target.value });
                }}
              />
            </div>
          </>
        ) : null}
      </div>

      {showSkill ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.skill}>Skill (tuỳ chọn)</Label>
          <Select
            value={draft.skillId ?? NO_SKILL}
            disabled={disabled}
            onValueChange={(value) => {
              onSkillChange(value === NO_SKILL ? undefined : SkillIdSchema.parse(value));
            }}
          >
            <SelectTrigger id={ids.skill} title={skill?.description}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SKILL}>Không dùng skill</SelectItem>
              {skills.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.language === "vi" ? " (tiếng Việt)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{skillHint(skill, language)}</span>
        </div>
      ) : null}

      {showRanking ? (
        <div className="flex flex-col gap-1.5">
          <Label>Cách AI xếp hạng media</Label>
          <RankingModePicker
            value={draft.rankingMode}
            onChange={(rankingMode) => {
              onChange({ rankingMode });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
