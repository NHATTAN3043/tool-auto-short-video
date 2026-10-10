"use client";

import {
  DEFAULT_MAX_WORDS_PER_SCENE,
  type Project,
  type ScenePlanSuggestion,
  type VisualPlan,
  type VisualPlansSuggestion,
} from "@studio/domain";
import { CheckIcon, ImageIcon, ListTreeIcon, SparklesIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

import { useAiTask, type AiTaskController } from "../hooks/use-ai-task";
import { AI_DURATION_OPTIONS, sceneNumbers, visualTask } from "../model";
import { AiConfirmDialog, AiTaskStatus } from "./AiTaskControls";

const SELECT_CLASS =
  "h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function ReviewActions({
  applyLabel,
  onApply,
  controller,
}: {
  applyLabel: string;
  onApply: () => void;
  controller: AiTaskController;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() => {
          onApply();
          controller.reset();
        }}
      >
        <CheckIcon />
        {applyLabel}
      </Button>
      <Button variant="outline" size="sm" onClick={controller.reset}>
        <XIcon />
        Bỏ gợi ý
      </Button>
    </div>
  );
}

function Queries({ queries }: { queries: readonly string[] }) {
  if (queries.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {queries.map((query) => (
        <span key={query} className="rounded-full border px-2 py-0.5 font-mono text-xs">
          {query}
        </span>
      ))}
    </span>
  );
}

/** The plan's keywords per language, so missing Vietnamese or Chinese ones are visible before applying. */
function PlanQueries({ plan }: { plan: VisualPlan }) {
  const rows = [
    { label: "EN", queries: plan.searchQueries },
    { label: "VI", queries: plan.localizedQueries?.vi ?? [] },
    { label: "ZH", queries: plan.localizedQueries?.zh ?? [] },
  ].filter((row) => row.queries.length > 0);
  return (
    <span className="flex flex-col gap-1">
      {rows.map((row) => (
        <span key={row.label} className="flex items-start gap-1.5">
          <span className="w-6 shrink-0 pt-0.5 text-xs text-muted-foreground">{row.label}</span>
          <Queries queries={row.queries} />
        </span>
      ))}
    </span>
  );
}

function ScenePlanPreview({ plan }: { plan: ScenePlanSuggestion }) {
  return (
    <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
      {plan.scenes.map((scene, index) => (
        <li key={index} className="flex flex-col gap-1">
          <span>
            <span className="font-medium">Cảnh {index + 1}:</span> {scene.narration}
          </span>
          <span className="text-xs text-muted-foreground">
            {scene.visualPlan.preferredMedia === "video" ? "Video" : "Ảnh"} · {scene.visualPlan.intent}
          </span>
          <PlanQueries plan={scene.visualPlan} />
        </li>
      ))}
    </ol>
  );
}

function VisualPlansPreview({ project, plans }: { project: Project; plans: VisualPlansSuggestion }) {
  return (
    <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
      {plans.plans.map((plan) => (
        <li key={plan.sceneId} className="flex flex-col gap-1">
          <span>
            <span className="font-medium">Cảnh {sceneNumbers(project, [plan.sceneId]) || "?"}:</span>{" "}
            {plan.visualPlan.intent} ({plan.visualPlan.preferredMedia === "video" ? "video" : "ảnh"})
          </span>
          <PlanQueries plan={plan.visualPlan} />
        </li>
      ))}
    </ul>
  );
}

/**
 * AI assistant of the project: idea → script, script → scenes, scenes → visual keywords. Each part shows
 * only when its automation toggle is on. Results are suggestions; the editor applies them on request.
 */
export function AiAssistantPanel({
  project,
  onApplyScript,
  onApplyScenePlan,
  onApplyVisualPlans,
}: {
  project: Project;
  onApplyScript: (script: string) => void;
  onApplyScenePlan: (plan: ScenePlanSuggestion) => void;
  onApplyVisualPlans: (plans: VisualPlansSuggestion) => void;
}) {
  const settings = project.automationSettings;
  const ideaId = useId();
  const durationId = useId();
  const toneId = useId();
  const [idea, setIdea] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [tone, setTone] = useState("");
  const scriptAi = useAiTask(project.id);
  const scenesAi = useAiTask(project.id);
  const visualAi = useAiTask(project.id);

  const missingVisual = visualTask(project, true);
  const allVisual = visualTask(project, false);
  const scriptResult = scriptAi.state.step === "review" ? scriptAi.state.result : null;
  const scenesResult = scenesAi.state.step === "review" ? scenesAi.state.result : null;
  const visualResult = visualAi.state.step === "review" ? visualAi.state.result : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-5" />
          Trợ lý AI
        </CardTitle>
        <CardDescription>
          AI chỉ đưa ra gợi ý. Mỗi lượt hiện chi phí ước tính trước khi chạy, và bạn xem lại rồi mới áp dụng
          (có thể hoàn tác).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {settings.scriptGeneration ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">1. Ý tưởng → script</h3>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ideaId}>Ý tưởng video</Label>
              <Textarea
                id={ideaId}
                value={idea}
                placeholder="Ví dụ: 3 sự thật thú vị về loài mèo mà ít ai biết"
                onChange={(event) => {
                  setIdea(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor={durationId}>Thời lượng</Label>
                <select
                  id={durationId}
                  className={SELECT_CLASS}
                  value={duration}
                  onChange={(event) => {
                    setDuration(Number(event.target.value));
                  }}
                >
                  {AI_DURATION_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} giây
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-2">
                <Label htmlFor={toneId}>Giọng văn (tuỳ chọn)</Label>
                <Input
                  id={toneId}
                  value={tone}
                  placeholder="hài hước, truyền cảm hứng…"
                  onChange={(event) => {
                    setTone(event.target.value);
                  }}
                />
              </div>
              <Button
                disabled={idea.trim().length < 3 || scriptAi.busy}
                onClick={() => {
                  void scriptAi.prepare({
                    type: "script",
                    input: {
                      idea: idea.trim(),
                      targetDurationSec: duration,
                      ...(tone.trim() !== "" && { tone: tone.trim() }),
                    },
                  });
                }}
              >
                <SparklesIcon />
                Viết script bằng AI
              </Button>
            </div>
            <AiTaskStatus controller={scriptAi} />
            {scriptResult?.type === "script" ? (
              <div className="flex flex-col gap-2">
                {scriptResult.suggestion.title ? (
                  <p className="text-sm font-medium">{scriptResult.suggestion.title}</p>
                ) : null}
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm">
                  {scriptResult.suggestion.script}
                </pre>
                <ReviewActions
                  controller={scriptAi}
                  applyLabel={project.script.trim() === "" ? "Dùng script này" : "Thay script hiện tại"}
                  onApply={() => {
                    onApplyScript(scriptResult.suggestion.script);
                  }}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {settings.scenePlanning ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">2. Chia cảnh và gợi ý hình bằng AI</h3>
            <p className="text-sm text-muted-foreground">
              AI chia script hiện tại thành cảnh (tối đa {DEFAULT_MAX_WORDS_PER_SCENE} từ mỗi cảnh) và đề xuất
              từ khoá hình cho từng cảnh.
            </p>
            <div>
              <Button
                variant="outline"
                disabled={project.script.trim() === "" || scenesAi.busy}
                onClick={() => {
                  void scenesAi.prepare({
                    type: "scenes",
                    input: { script: project.script, maxWordsPerScene: DEFAULT_MAX_WORDS_PER_SCENE },
                  });
                }}
              >
                <ListTreeIcon />
                Chia cảnh bằng AI
              </Button>
            </div>
            <AiTaskStatus controller={scenesAi} />
            {scenesResult?.type === "scenes" ? (
              <div className="flex flex-col gap-2">
                <ScenePlanPreview plan={scenesResult.suggestion} />
                <ReviewActions
                  controller={scenesAi}
                  applyLabel={
                    project.scenes.length === 0
                      ? `Tạo ${String(scenesResult.suggestion.scenes.length)} cảnh`
                      : `Thay ${String(project.scenes.length)} cảnh hiện có`
                  }
                  onApply={() => {
                    onApplyScenePlan(scenesResult.suggestion);
                  }}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {settings.visualKeywords ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">3. Gợi ý hình cho các cảnh hiện có</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={missingVisual === null || visualAi.busy}
                onClick={() => {
                  if (missingVisual) void visualAi.prepare(missingVisual);
                }}
              >
                <ImageIcon />
                Cảnh chưa có gợi ý ({missingVisual?.input.scenes.length ?? 0})
              </Button>
              <Button
                variant="ghost"
                disabled={allVisual === null || visualAi.busy}
                onClick={() => {
                  if (allVisual) void visualAi.prepare(allVisual);
                }}
              >
                Làm lại cho mọi cảnh
              </Button>
            </div>
            <AiTaskStatus controller={visualAi} />
            {visualResult?.type === "visual" ? (
              <div className="flex flex-col gap-2">
                <VisualPlansPreview project={project} plans={visualResult.suggestion} />
                <ReviewActions
                  controller={visualAi}
                  applyLabel={`Áp dụng cho ${String(visualResult.suggestion.plans.length)} cảnh`}
                  onApply={() => {
                    onApplyVisualPlans(visualResult.suggestion);
                  }}
                />
              </div>
            ) : null}
          </section>
        ) : null}
      </CardContent>

      <AiConfirmDialog controller={scriptAi} />
      <AiConfirmDialog controller={scenesAi} />
      <AiConfirmDialog controller={visualAi} />
    </Card>
  );
}
