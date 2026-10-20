"use client";

import type { FullAiDraft, FullAiDraftStep } from "@studio/domain";
import { CheckIcon, CircleAlertIcon, Loader2Icon, PencilIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { answerLines, STUDIO_STEPS, studioStepNumber } from "../model";

// Small pieces of the Full AI page (ADR 0015), shared by its steps.

/** Full steps from 640px; one line `Bước 2/3 · Câu hỏi` below, where three labels do not fit. */
export function StudioStepper({ step }: { step: FullAiDraftStep }) {
  const current = studioStepNumber(step);
  return (
    <>
      <p className="text-sm sm:hidden">
        <span className="text-muted-foreground">
          Bước {current}/{STUDIO_STEPS.length}&nbsp;·
        </span>{" "}
        <span className="font-medium">{STUDIO_STEPS[current - 1]?.label}</span>
      </p>
      <ol className="hidden items-center gap-2 text-sm sm:flex">
        {STUDIO_STEPS.map((item, index) => {
          const number = index + 1;
          const done = number < current;
          const active = number === current;
          return (
            <li key={item.id} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-muted text-foreground",
                  !active && !done && "border text-muted-foreground",
                )}
              >
                {done ? <CheckIcon className="size-3.5" aria-label="Xong" /> : number}
              </span>
              <span className={active ? "font-medium" : "text-muted-foreground"}>{item.label}</span>
              {number < STUDIO_STEPS.length ? (
                <span className="mx-1 h-px w-6 bg-border lg:w-10" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function StudioError({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="flex items-center gap-2">
        <CircleAlertIcon className="size-4 shrink-0" />
        {message}
      </span>
      {children ? <span className="flex gap-2">{children}</span> : null}
    </div>
  );
}

/** A status line over skeleton rows shaped like what is coming. */
export function StudioLoading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2Icon className="size-4 animate-spin" />
        {label}
      </p>
      {children}
    </div>
  );
}

export function StudioEmpty({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      {children ? <span className="mt-2 flex flex-wrap justify-center gap-2">{children}</span> : null}
    </div>
  );
}

export const Skeleton = ({ className }: { className: string }) => (
  <div className={cn("animate-pulse rounded-md bg-muted", className)} />
);

/** Left column from the second step: what the AI works from, each part with a way back to edit it. */
export function BriefSummary({
  draft,
  languageLabel,
  onEditIdea,
  onEditAnswers,
}: {
  draft: FullAiDraft;
  languageLabel: string;
  onEditIdea: () => void;
  onEditAnswers: () => void;
}) {
  const tone = draft.tone.trim();
  const answers = answerLines(draft);
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Tóm tắt</h2>
          <Button variant="ghost" size="sm" onClick={onEditIdea}>
            <PencilIcon />
            Sửa
          </Button>
        </div>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Ý tưởng</dt>
            <dd className="mt-0.5 break-words">{draft.idea.trim()}</dd>
          </div>
          <div className="flex gap-6">
            <div>
              <dt className="text-xs text-muted-foreground">Thời lượng</dt>
              <dd className="mt-0.5">{draft.targetDurationSec} giây</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ngôn ngữ</dt>
              <dd className="mt-0.5">{languageLabel}</dd>
            </div>
          </div>
          {tone !== "" ? (
            <div>
              <dt className="text-xs text-muted-foreground">Giọng văn</dt>
              <dd className="mt-0.5 break-words">{tone}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {draft.step === "outline" && answers.length > 0 ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Câu trả lời</h2>
            <Button variant="ghost" size="sm" onClick={onEditAnswers}>
              <PencilIcon />
              Sửa
            </Button>
          </div>
          <ol className="flex flex-col gap-2 text-sm">
            {answers.map((item) => (
              <li key={item.question}>
                <div className="text-xs text-muted-foreground">{item.question}</div>
                <div className="break-words">{item.answer}</div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}
