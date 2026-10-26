"use client";

import {
  addOutlineScene,
  briefKey,
  CONTENT_LANGUAGE_LABELS,
  editOutlineScene,
  formatUsd,
  fullAiSteps,
  moveOutlineScene,
  projectLanguage,
  removeOutlineScene,
  setDraftOther,
  setDraftOutline,
  setDraftQuestions,
  setProjectLanguage,
  toggleDraftChoice,
  type ContentLanguage,
  type FullAiDraft,
  type FullAiDraftStep,
  type Project,
  type SkillId,
  type SkillSummary,
} from "@studio/domain";
import { ArrowLeftIcon, ArrowRightIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { estimateAi } from "@/features/ai";
import { saveProject } from "@/features/project";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { estimateFullAi } from "../api";
import { useFullAi } from "../hooks/use-full-ai";
import { useAiRun, useEstimate, useFullAiDraft } from "../hooks/use-full-ai-studio";
import {
  approveRequest,
  briefTask,
  canAskFirst,
  ideaError,
  initialDraft,
  outlineTask,
  quickRequest,
  rewriteTask,
  runUsesSkill,
  sourceClips,
  sourceVideos,
  stepsLine,
  withInstalledSkill,
} from "../model";
import { FullAiConfirmDialog } from "./FullAiConfirmDialog";
import { FullAiLock } from "./FullAiLock";
import { IdeaStep } from "./IdeaStep";
import { OutlineFeedback, OutlineStep, type OutlineActions, type RewriteState } from "./OutlineStep";
import { QuestionsStep } from "./QuestionsStep";
import { BriefSummary, StudioError, StudioStepper } from "./studio-parts";
import { UnanalyzedClipsHint } from "./UnanalyzedClipsHint";

type LastRun = { kind: "questions" } | { kind: "outline"; feedback: string; skipAnswers: boolean };

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

/**
 * The Full AI page (ADR 0015): idea → the AI's questions → an outline to review, then the run. Nothing
 * paid runs before the user approves the outline, except the two short AI calls that write the questions
 * and the outline, each estimated first. The draft is saved as the user goes.
 */
export function FullAiStudio({
  project: initialProject,
  savedDraft,
  skills,
  ttsAvailable,
}: {
  project: Project;
  savedDraft: FullAiDraft | null;
  skills: readonly SkillSummary[];
  ttsAvailable: boolean;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [start] = useState(() =>
    savedDraft
      ? withInstalledSkill(savedDraft, skills)
      : initialDraft(initialProject, skills, new Date().toISOString()),
  );
  const { draft, change, flush, status } = useFullAiDraft(project.id, start);
  const main = useAiRun(project.id);
  const rewriteRun = useAiRun(project.id);
  const [rewrite, setRewrite] = useState<RewriteState | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [durationError, setDurationError] = useState<string | null>(null);

  const projectId = project.id;
  const openReview = useCallback(() => {
    router.push(`/projects/${encodeURIComponent(projectId)}/review`);
  }, [router, projectId]);
  const fullAi = useFullAi(projectId, true, flush, openReview);

  const language = projectLanguage(project);
  const languageLabel = CONTENT_LANGUAGE_LABELS[language];
  // A source video is cut by the run itself (ADR 0020): no questions, no outline.
  const onSource = draft.sourceVideo !== undefined;
  const askFirst = canAskFirst(project) && !onSource;
  // Whether the source is analyzed only changes the paid steps, which the server's estimate lists.
  const quickSteps = fullAiSteps(
    project.automationSettings,
    { tts: ttsAvailable },
    undefined,
    onSource ? { analyzed: true } : undefined,
  );
  const step: FullAiDraftStep = askFirst ? draft.step : "idea";
  const startError = durationError ?? ideaError(draft, project);
  const preparing = fullAi.state.step === "estimating" || fullAi.state.step === "running";
  const approval = approveRequest(draft, language);

  const ideaHint = useEstimate(
    step === "idea" && askFirst && startError === null ? JSON.stringify(briefTask(draft, language)) : null,
    () => estimateAi(projectId, briefTask(draft, language)),
  );
  const outlineHint = useEstimate(
    step === "questions" && !main.busy ? JSON.stringify(outlineTask(draft, language)) : null,
    () => estimateAi(projectId, outlineTask(draft, language)),
  );
  const runHint = useEstimate(step === "outline" && approval ? JSON.stringify(approval) : null, () =>
    approval
      ? estimateFullAi(projectId, { ...approval, replaceScenes: true })
      : Promise.reject(new Error("Chưa có khung kịch bản")),
  );

  const goTo = (next: FullAiDraftStep) => {
    main.clearError();
    change((current) => ({ ...current, step: next }));
  };

  const askQuestions = async () => {
    const key = briefKey(draft, language);
    if (draft.askedFor === key) {
      goTo("questions");
      return;
    }
    setLastRun({ kind: "questions" });
    change((current) => ({ ...current, step: "questions" }));
    const outcome = await main.run(briefTask(draft, language));
    if (outcome.ok && outcome.result.type === "brief_questions") {
      const { suggestion } = outcome.result;
      change((current) => setDraftQuestions(current, suggestion, key));
    }
  };

  const makeOutline = async (feedback = "", skipAnswers = false) => {
    setLastRun({ kind: "outline", feedback, skipAnswers });
    const source = skipAnswers ? { ...draft, answers: [] } : draft;
    change((current) => ({ ...current, step: "outline" }));
    const outcome = await main.run(outlineTask(source, language, feedback));
    if (outcome.ok && outcome.result.type === "script_outline") {
      const { suggestion } = outcome.result;
      change((current) => setDraftOutline(current, suggestion));
      setRewrite(null);
    }
  };

  const retry = () => {
    if (lastRun?.kind === "outline") void makeOutline(lastRun.feedback, lastRun.skipAnswers);
    else void askQuestions();
  };

  const runQuick = () => {
    void fullAi.prepare(quickRequest(draft, project, quickSteps, language));
  };

  const approve = async () => {
    if (!approval) return;
    await flush();
    void fullAi.prepare(approval);
  };

  const changeLanguage = (next: ContentLanguage) => {
    setLanguageError(null);
    saveProject(setProjectLanguage(project, next))
      .then(setProject)
      .catch((error: unknown) => {
        setLanguageError(`Không đổi được ngôn ngữ: ${errorText(error)}`);
      });
  };

  const changeSkill = (skillId: SkillId | undefined) => {
    change((current) => {
      const next = { ...current };
      delete next.skillId;
      return skillId === undefined ? next : { ...next, skillId };
    });
  };

  const outlineActions: OutlineActions = {
    onEdit: (sceneId, narration) => {
      change((current) => editOutlineScene(current, sceneId, narration));
    },
    onMove: (sceneId, delta) => {
      change((current) => moveOutlineScene(current, sceneId, delta));
    },
    onRemove: (sceneId) => {
      if (rewrite?.sceneId === sceneId) setRewrite(null);
      change((current) => removeOutlineScene(current, sceneId));
    },
    onAdd: () => {
      change((current) => addOutlineScene(current, null));
    },
    onRewrite: (sceneId) => {
      const task = rewriteTask(draft, sceneId, language);
      if (!task) return;
      setRewrite({ sceneId, busy: true });
      void rewriteRun.run(task).then((outcome) => {
        if (outcome.ok && outcome.result.type === "rewrite_scene") {
          setRewrite({ sceneId, busy: false, narration: outcome.result.suggestion.narration });
        } else {
          setRewrite({
            sceneId,
            busy: false,
            error: outcome.ok ? "AI không trả về lời mới." : outcome.error,
          });
        }
      });
    },
    onTakeRewrite: () => {
      if (rewrite?.narration === undefined) return;
      const { sceneId, narration } = rewrite;
      change((current) => editOutlineScene(current, sceneId, narration));
      setRewrite(null);
    },
    onDropRewrite: () => {
      setRewrite(null);
    },
    onRegenerate: (feedback) => {
      void makeOutline(feedback);
    },
  };

  const mainError = !main.busy ? main.error : null;
  const hasScenes = (draft.outline?.scenes.length ?? 0) > 0;

  let body;
  let footer;
  if (step === "idea") {
    body = (
      <>
        <IdeaStep
          draft={draft}
          videos={sourceVideos(project)}
          clips={draft.sourceVideo ? sourceClips(project, draft.sourceVideo.assetId) : []}
          language={language}
          askFirst={askFirst}
          writesScript={canAskFirst(project)}
          skills={skills}
          showSkill={skills.length > 0 && (askFirst || runUsesSkill(quickSteps, project.automationSettings))}
          showRanking={quickSteps.includes("rank")}
          disabled={preparing}
          onChange={(patch) => {
            change((current) => ({ ...current, ...patch }));
          }}
          onSkillChange={changeSkill}
          onLanguageChange={changeLanguage}
          onDurationError={setDurationError}
        />
        {startError ? <p className="text-sm text-muted-foreground">{startError}</p> : null}
        {quickSteps.includes("media") ? <UnanalyzedClipsHint project={project} /> : null}
      </>
    );
    footer = (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {ideaHint ? (
          <span className="mr-auto text-xs text-muted-foreground">
            AI hỏi lại ≈ {formatUsd(ideaHint.expectedUsd)}
          </span>
        ) : null}
        {askFirst ? (
          <>
            <Button variant="ghost" disabled={startError !== null || preparing} onClick={runQuick}>
              Chạy luôn, không hỏi
            </Button>
            <Button disabled={startError !== null || preparing} onClick={() => void askQuestions()}>
              Tiếp: AI hỏi lại
              <ArrowRightIcon />
            </Button>
          </>
        ) : (
          <Button disabled={startError !== null || preparing} onClick={runQuick}>
            <SparklesIcon />
            {fullAi.state.step === "estimating" ? "Đang ước tính…" : "Ước tính và chạy"}
          </Button>
        )}
      </div>
    );
  } else if (step === "questions") {
    body = (
      <>
        {mainError ? (
          <StudioError message={mainError}>
            <Button variant="outline" size="sm" onClick={retry}>
              Thử lại
            </Button>
          </StudioError>
        ) : null}
        <QuestionsStep
          draft={draft}
          busy={main.busy}
          error={mainError !== null}
          onToggle={(questionId, option) => {
            change((current) => toggleDraftChoice(current, questionId, option));
          }}
          onOther={(questionId, text) => {
            change((current) => setDraftOther(current, questionId, text));
          }}
        />
      </>
    );
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            goTo("idea");
          }}
        >
          <ArrowLeftIcon />
          Sửa ý tưởng
        </Button>
        <span className="flex flex-wrap items-center gap-2">
          {outlineHint ? (
            <span className="text-xs text-muted-foreground">≈ {formatUsd(outlineHint.expectedUsd)}</span>
          ) : null}
          {draft.outline && !main.busy ? (
            <Button
              variant="ghost"
              onClick={() => {
                goTo("outline");
              }}
            >
              Về khung hiện tại
            </Button>
          ) : null}
          {draft.questions.length > 0 || mainError ? (
            <Button variant="ghost" disabled={main.busy} onClick={() => void makeOutline("", true)}>
              Bỏ qua câu hỏi
            </Button>
          ) : null}
          <Button disabled={main.busy || mainError !== null} onClick={() => void makeOutline()}>
            <SparklesIcon />
            Tạo khung kịch bản
          </Button>
        </span>
      </div>
    );
  } else {
    const nextSteps = runHint ? stepsLine(runHint.steps.filter((item) => item !== "scenes")) : "";
    body = (
      <>
        {mainError ? (
          <StudioError message={mainError}>
            <Button variant="outline" size="sm" onClick={retry}>
              Thử lại
            </Button>
          </StudioError>
        ) : null}
        <OutlineStep draft={draft} busy={main.busy} rewrite={rewrite} actions={outlineActions} />
      </>
    );
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 text-sm">
          {runHint ? (
            <>
              <span>
                <span className="font-medium">Tạo video ≈ {formatUsd(runHint.expectedUsd)}</span>{" "}
                <span className="text-muted-foreground">(tối đa {formatUsd(runHint.maxUsd)})</span>
              </span>
              {nextSteps !== "" ? (
                <span className="text-xs text-muted-foreground">Tiếp theo: {nextSteps}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              {approval ? "Đang ước tính chi phí…" : "Cần ít nhất một cảnh có lời đọc."}
            </span>
          )}
        </div>
        <span className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              goTo(draft.askedFor === undefined ? "idea" : "questions");
            }}
          >
            <ArrowLeftIcon />
            {draft.askedFor === undefined ? "Sửa ý tưởng" : "Quay lại câu hỏi"}
          </Button>
          <Button disabled={!approval || main.busy || preparing} onClick={() => void approve()}>
            <SparklesIcon />
            {fullAi.state.step === "estimating" ? "Đang ước tính…" : "Duyệt và tạo video"}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b bg-background px-4 py-3 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              href={`/projects/${encodeURIComponent(projectId)}`}
              aria-label="Về trình chỉnh sửa"
              title="Về trình chỉnh sửa"
              onClick={() => void flush()}
            >
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Full AI</div>
            <h1 className="truncate text-lg leading-tight font-semibold" title={project.name}>
              {project.name}
            </h1>
          </div>
        </div>
        {askFirst ? <StudioStepper step={step} /> : null}
      </header>

      <div
        className={cn(
          "mx-auto grid w-full items-start gap-6 p-4 lg:p-6",
          step === "idea" ? "max-w-2xl" : "max-w-6xl lg:grid-cols-[300px_minmax(0,1fr)]",
        )}
      >
        {step !== "idea" ? (
          <BriefSummary
            draft={draft}
            languageLabel={languageLabel}
            onEditIdea={() => {
              goTo("idea");
            }}
            onEditAnswers={() => {
              goTo("questions");
            }}
          />
        ) : null}
        <section className="flex min-w-0 flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground">
          <div className="flex flex-col gap-4 px-6">
            {status === "error" ? (
              <StudioError message="Chưa lưu được bản nháp.">
                <Button variant="outline" size="sm" onClick={() => void flush()}>
                  Lưu lại
                </Button>
              </StudioError>
            ) : null}
            {languageError ? <StudioError message={languageError} /> : null}
            {fullAi.state.step === "error" ? (
              <StudioError message={fullAi.state.message}>
                <Button variant="ghost" size="sm" onClick={fullAi.reset}>
                  Đóng
                </Button>
              </StudioError>
            ) : null}
            {body}
          </div>
          {step === "outline" && hasScenes && !main.busy ? (
            <div className="px-6">
              <OutlineFeedback onRegenerate={outlineActions.onRegenerate} />
            </div>
          ) : null}
          <div className="border-t px-6 pt-6">{footer}</div>
        </section>
      </div>

      <FullAiConfirmDialog project={project} controller={fullAi} />
      {fullAi.state.step === "running" ? <FullAiLock job={fullAi.state.job} /> : null}
    </div>
  );
}
