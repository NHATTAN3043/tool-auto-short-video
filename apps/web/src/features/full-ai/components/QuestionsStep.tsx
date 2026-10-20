"use client";

import { draftAnswer, type BriefQuestion, type FullAiDraft } from "@studio/domain";
import { CheckIcon, MessageSquareIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Input } from "@/shared/ui/input";

import { Skeleton, StudioEmpty, StudioLoading } from "./studio-parts";

function Choice({
  label,
  checked,
  multi,
  onToggle,
}: {
  label: string;
  checked: boolean;
  multi: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={checked}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm transition-colors outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        checked && "border-primary ring-1 ring-primary",
      )}
      onClick={onToggle}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center border",
          multi ? "rounded-[4px]" : "rounded-full",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked ? (
          multi ? (
            <CheckIcon className="size-3" />
          ) : (
            <span className="size-1.5 rounded-full bg-primary-foreground" />
          )
        ) : null}
      </span>
      {label}
    </button>
  );
}

function QuestionField({
  draft,
  question,
  index,
  onToggle,
  onOther,
}: {
  draft: FullAiDraft;
  question: BriefQuestion;
  index: number;
  onToggle: (option: number | null) => void;
  onOther: (text: string) => void;
}) {
  const answer = draftAnswer(draft, question.id);
  const multi = question.kind === "multi";
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 flex items-center gap-2 text-sm font-medium">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">
          {index + 1}
        </span>
        {question.text}
        {multi ? <span className="font-normal text-muted-foreground">· Chọn nhiều</span> : null}
      </legend>
      {question.kind === "text" ? (
        <Input
          className="bg-background"
          maxLength={500}
          aria-label={question.text}
          placeholder="Trả lời, hoặc để trống cho AI tự chọn"
          value={answer.other}
          onChange={(event) => {
            onOther(event.target.value);
          }}
        />
      ) : (
        <>
          <div
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
            role={multi ? "group" : "radiogroup"}
            aria-label={question.text}
          >
            {question.options.map((option, optionIndex) => (
              <Choice
                key={option}
                label={option}
                multi={multi}
                checked={answer.selected.includes(optionIndex)}
                onToggle={() => {
                  onToggle(optionIndex);
                }}
              />
            ))}
            <Choice
              label="Khác…"
              multi={multi}
              checked={answer.otherOn}
              onToggle={() => {
                onToggle(null);
              }}
            />
          </div>
          {answer.otherOn ? (
            <Input
              className="bg-background"
              maxLength={500}
              aria-label="Câu trả lời khác"
              placeholder="Câu trả lời của bạn"
              value={answer.other}
              onChange={(event) => {
                onOther(event.target.value);
              }}
            />
          ) : null}
        </>
      )}
    </fieldset>
  );
}

/** Second step: the AI's questions, each answered by a choice or free text; empty ones are left to the AI. */
export function QuestionsStep({
  draft,
  busy,
  error,
  onToggle,
  onOther,
}: {
  draft: FullAiDraft;
  busy: boolean;
  /** Shown above, with its own actions, by the page. */
  error: boolean;
  onToggle: (questionId: string, option: number | null) => void;
  onOther: (questionId: string, text: string) => void;
}) {
  if (busy) {
    return (
      <StudioLoading label="AI đang soạn câu hỏi, thường mất 5–15 giây…">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex flex-col gap-2.5">
            <Skeleton className="h-4 w-56" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        ))}
      </StudioLoading>
    );
  }
  if (error) return null;
  if (draft.questions.length === 0) {
    return (
      <StudioEmpty
        icon={<MessageSquareIcon />}
        title="Ý tưởng đã đủ rõ, AI không cần hỏi thêm"
        description="Bấm tạo khung kịch bản để xem lời đọc từng cảnh."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        AI cần hiểu thêm {draft.questions.length} điểm. Câu nào bỏ trống, AI tự chọn.
      </p>
      {draft.questions.map((question, index) => (
        <QuestionField
          key={question.id}
          draft={draft}
          question={question}
          index={index}
          onToggle={(option) => {
            onToggle(question.id, option);
          }}
          onOther={(text) => {
            onOther(question.id, text);
          }}
        />
      ))}
    </div>
  );
}
