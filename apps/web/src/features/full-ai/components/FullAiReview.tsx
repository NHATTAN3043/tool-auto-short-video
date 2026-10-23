"use client";

import {
  formatUsd,
  projectLanguage,
  type FullAiResult,
  type Project,
  type RenderJob,
  type SkillSummary,
} from "@studio/domain";
import { ArrowLeftIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { AiConfirmDialog, useAiTask } from "@/features/ai";
import { SceneMediaSearch, type PickedMedia } from "@/features/media-search";
import { SaveIndicator } from "@/features/scenes/components/SaveIndicator";
import { useProjectEditor } from "@/features/scenes/hooks/use-project-editor";
import {
  SceneVoiceControls,
  useVoiceCatalog,
  useVoiceJobs,
  VoiceConfirmDialog,
  voiceStarter,
} from "@/features/voice";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { alternativesFor, rememberedSkill, reviewStats } from "../model";
import { ReviewSceneCard } from "./ReviewSceneCard";
import { SkillPicker } from "./SkillPicker";

/**
 * The review screen after a Full AI run. Every scene can be kept, given another media, rewritten (as a
 * suggestion to accept) or voiced again; edits autosave like the editor.
 */
export function FullAiReview({
  project: initial,
  latest,
  ttsAvailable,
  aiAvailable,
  skills,
}: {
  project: Project;
  latest: { job: RenderJob; result: FullAiResult | null } | null;
  ttsAvailable: boolean;
  aiAvailable: boolean;
  /** Installed skills; a rewrite can send one along (ADR 0012). */
  skills: readonly SkillSummary[];
}) {
  const editor = useProjectEditor(initial);
  const { project } = editor;
  const voiceEnabled = ttsAvailable && project.automationSettings.voiceGeneration;
  const voiceJobs = useVoiceJobs(project.id, voiceEnabled, editor.flushSave, editor.voicesGenerated);
  // Only needed to give a project without voice settings its default voice.
  const voiceCatalog = useVoiceCatalog(voiceEnabled && project.voice === undefined);
  const startVoice = voiceStarter(voiceCatalog.catalog, editor.saveVoiceSettings);
  const rewrite = useAiTask(project.id);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const canRewrite = aiAvailable && project.automationSettings.scriptGeneration;
  // Shared with the Full AI panel: the skill of the run is preselected for its rewrites.
  const rewriteSkill = rememberedSkill(project, skills);
  const rankingEnabled = aiAvailable && project.automationSettings.mediaRanking;
  const result = latest?.result ?? null;
  const stats = reviewStats(project);
  const { assetAdded, assignMedia } = editor;

  const pickMedia = useCallback(
    (sceneId: string, { asset, startMs }: PickedMedia) => {
      assetAdded(asset);
      assignMedia(sceneId, asset.id, startMs);
    },
    [assetAdded, assignMedia],
  );

  const suggestion =
    rewrite.state.step === "review" && rewrite.state.result.type === "rewrite_scene"
      ? rewrite.state.result.suggestion.narration
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-background/95 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${encodeURIComponent(project.id)}`}>
              <ArrowLeftIcon />
              Trình chỉnh sửa
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Duyệt kết quả Full AI · {project.name}</h1>
        </div>
        <SaveIndicator
          status={editor.saveStatus}
          canUndo={editor.canUndo}
          onUndo={editor.undo}
          onRetry={editor.retrySave}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tổng quan</CardTitle>
          <CardDescription>
            Đã giữ {stats.approved}/{stats.total} cảnh · có media {stats.withMedia}/{stats.total}
            {stats.voiceToRedo > 0 ? ` · ${String(stats.voiceToRedo)} cảnh cần tạo lại giọng` : ""}
            {latest?.job.fullAi?.costUsd !== undefined
              ? ` · chi phí lượt chạy ≈ ${formatUsd(latest.job.fullAi.costUsd)}`
              : ""}
          </CardDescription>
        </CardHeader>
        {result && result.warnings.length > 0 ? (
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </CardContent>
        ) : null}
        {canRewrite && skills.length > 0 ? (
          <CardContent>
            <SkillPicker
              label="Skill khi viết lại cảnh"
              skills={skills}
              language={projectLanguage(editor.project)}
              value={rewriteSkill}
              onChange={editor.setAiSkill}
            />
          </CardContent>
        ) : null}
        {latest === null ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Dự án này chưa chạy Full AI; vẫn duyệt được từng cảnh.
            </p>
          </CardContent>
        ) : null}
      </Card>

      {editor.lastError ? (
        <p className="text-sm text-destructive" role="alert">
          {editor.lastError}
        </p>
      ) : null}
      {rewrite.state.step === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {rewrite.state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {project.scenes.map((scene, index) => (
          <ReviewSceneCard
            key={scene.id}
            project={project}
            scene={scene}
            index={index}
            alternatives={alternativesFor(result, project, scene.id)}
            actions={{
              onApprove: (sceneId, approved) => {
                editor.setSceneStatus(sceneId, approved ? "approved" : "draft");
              },
              onMediaPicked: pickMedia,
              onRewrite: canRewrite
                ? (sceneId, instruction) => {
                    const target = project.scenes.find((candidate) => candidate.id === sceneId);
                    if (!target || target.narration.trim() === "") return;
                    setRewriting(sceneId);
                    const trimmed = instruction.trim();
                    void rewrite.prepare({
                      type: "rewrite_scene",
                      input: {
                        script: project.script,
                        narration: target.narration,
                        ...(trimmed !== "" && { instruction: trimmed }),
                        ...(rewriteSkill !== undefined && { skillId: rewriteSkill }),
                      },
                    });
                  }
                : null,
            }}
            rewriteSuggestion={
              rewriting === scene.id && (rewrite.state.step === "running" || suggestion !== null) ? (
                <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm">
                  {suggestion === null ? (
                    <span role="status">AI đang viết lại…</span>
                  ) : (
                    <>
                      <span className="font-medium">Gợi ý mới</span>
                      <span className="whitespace-pre-wrap">{suggestion}</span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            editor.editNarration(scene.id, suggestion);
                            editor.commitTyping();
                            rewrite.reset();
                            setRewriting(null);
                          }}
                        >
                          <CheckIcon />
                          Áp dụng
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            rewrite.reset();
                            setRewriting(null);
                          }}
                        >
                          <XIcon />
                          Bỏ gợi ý
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null
            }
            voice={
              <SceneVoiceControls
                project={project}
                scene={scene}
                jobs={voiceJobs}
                generationEnabled={voiceEnabled}
                startVoice={startVoice}
              />
            }
            mediaSearch={
              <SceneMediaSearch
                projectId={project.id}
                sceneLabel={`Cảnh ${String(index + 1)}`}
                visualPlan={scene.visualPlan}
                narration={scene.narration}
                language={projectLanguage(project)}
                keywordSuggest={
                  aiAvailable
                    ? { sceneId: scene.id, script: project.script, onApply: editor.applyVisualPlans }
                    : null
                }
                onPicked={(asset) => {
                  pickMedia(scene.id, asset);
                }}
                ranking={
                  rankingEnabled
                    ? {
                        sceneId: scene.id,
                        narration: scene.narration,
                        ...(scene.visualPlan?.intent && { intent: scene.visualPlan.intent }),
                        mode: project.mediaRankingMode ?? "text",
                        onModeChange: editor.setMediaRankingMode,
                      }
                    : null
                }
              />
            }
          />
        ))}
      </div>

      <AiConfirmDialog controller={rewrite} />
      <VoiceConfirmDialog project={project} jobs={voiceJobs} />
    </div>
  );
}
