"use client";

import {
  CONTENT_LANGUAGE_LABELS,
  ContentLanguageSchema,
  SkillIdSchema,
  type ContentLanguage,
  type FullAiDraft,
  type SkillId,
  type SkillSummary,
} from "@studio/domain";
import { useId } from "react";

import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

import { FULL_AI_DURATIONS, skillHint } from "../model";
import { RankingModePicker } from "./RankingModePicker";

const NO_SKILL = "none";

/**
 * First step: the idea and the settings of the run. Without "Viết script" the run reads the project's
 * script instead, and only the language, the skill and the ranking mode apply.
 */
export function IdeaStep({
  draft,
  language,
  askFirst,
  skills,
  showSkill,
  showRanking,
  disabled,
  onChange,
  onSkillChange,
  onLanguageChange,
}: {
  draft: FullAiDraft;
  language: ContentLanguage;
  askFirst: boolean;
  skills: readonly SkillSummary[];
  /** Installed skills exist and a step of this run sends one. */
  showSkill: boolean;
  showRanking: boolean;
  disabled: boolean;
  /** Settings that are always present (the skill is optional, see onSkillChange). */
  onChange: (patch: Partial<Omit<FullAiDraft, "skillId">>) => void;
  onSkillChange: (skillId: SkillId | undefined) => void;
  onLanguageChange: (language: ContentLanguage) => void;
}) {
  const ids = { idea: useId(), language: useId(), duration: useId(), tone: useId(), skill: useId() };
  const skill = skills.find((candidate) => candidate.id === draft.skillId);

  return (
    <div className="flex flex-col gap-4">
      {askFirst ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.idea}>Ý tưởng</Label>
          <Textarea
            id={ids.idea}
            rows={3}
            maxLength={2000}
            disabled={disabled}
            className="bg-background"
            placeholder="Ví dụ: 5 sự thật thú vị về loài mèo"
            value={draft.idea}
            onChange={(event) => {
              onChange({ idea: event.target.value });
            }}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Dự án đang tắt “Viết script”: Full AI dùng script hiện tại. Bật lại trong cài đặt dự án để AI hỏi
          lại và viết khung kịch bản cho bạn duyệt.
        </p>
      )}

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
        {askFirst ? (
          <>
            <div className="flex w-28 flex-col gap-1.5">
              <Label htmlFor={ids.duration}>Thời lượng</Label>
              <Select
                value={String(draft.targetDurationSec)}
                disabled={disabled}
                onValueChange={(value) => {
                  onChange({ targetDurationSec: Number(value) });
                }}
              >
                <SelectTrigger id={ids.duration}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FULL_AI_DURATIONS.map((seconds) => (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {seconds} giây
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
