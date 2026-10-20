"use client";

import { fullAiSteps, type FullAiDraft, type Project } from "@studio/domain";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { getFullAiDraft } from "../api";
import { canAskFirst, STUDIO_STEPS, stepsLine, studioStepNumber } from "../model";

/**
 * The way into the Full AI page (ADR 0015), in the editor's AI tab. Shows where an unfinished draft
 * stopped. `beforeOpen` saves the editor first, so the page starts from what is on screen.
 */
export function FullAiPanel({
  project,
  ttsAvailable,
  beforeOpen,
}: {
  project: Project;
  ttsAvailable: boolean;
  beforeOpen: () => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<FullAiDraft | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFullAiDraft(project.id)
      .then((saved) => {
        if (!cancelled) setDraft(saved);
      })
      .catch(() => {
        // Not fatal: the page reads the draft again.
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const askFirst = canAskFirst(project);
  const started = draft !== null && (draft.step !== "idea" || draft.idea.trim() !== "");
  const step = draft ? studioStepNumber(draft.step) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          Full AI
        </CardTitle>
        <CardDescription>
          {askFirst
            ? "Đưa ý tưởng, trả lời vài câu hỏi, duyệt khung kịch bản rồi mới tạo video."
            : `Các bước sẽ chạy theo cài đặt dự án: ${stepsLine(fullAiSteps(project.automationSettings, { tts: ttsAvailable }))}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {started
            ? `Bản nháp đang ở bước ${String(step)}/${String(STUDIO_STEPS.length)}: ${STUDIO_STEPS[step - 1]?.label ?? ""}.`
            : "Mở trang Full AI để bắt đầu."}
        </p>
        <Button
          disabled={opening}
          onClick={() => {
            setOpening(true);
            void beforeOpen()
              .then(() => {
                router.push(`/projects/${encodeURIComponent(project.id)}/full-ai`);
              })
              .catch(() => {
                setOpening(false);
              });
          }}
        >
          {started ? "Tiếp tục bản nháp" : "Bắt đầu Full AI"}
          <ArrowRightIcon />
        </Button>
      </CardContent>
    </Card>
  );
}
