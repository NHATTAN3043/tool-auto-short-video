"use client";

import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { useCreateProjectForm } from "../hooks/use-create-project-form";
import { enabledCount, isCustomized, SETTING_KEYS } from "../model";
import { AutomationToggles } from "./AutomationToggles";
import { ModePicker } from "./ModePicker";

export function CreateProjectForm() {
  const form = useCreateProjectForm();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Dự án
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Tạo dự án mới</h1>
          <p className="text-sm text-muted-foreground">
            Video dọc 1080×1920 cho TikTok, YouTube Shorts và Facebook Reels.
          </p>
        </div>
      </div>

      <form
        className="flex flex-col rounded-xl border bg-card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
      >
        <div className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Tên dự án</Label>
            <Input
              id="project-name"
              value={form.draft.name}
              placeholder="Ví dụ: 5 mẹo tiết kiệm tiền"
              aria-invalid={form.nameError !== null}
              onChange={(event) => {
                form.setName(event.target.value);
              }}
            />
            {form.nameError ? <p className="text-sm text-destructive">{form.nameError}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cách làm video</Label>
            <ModePicker value={form.draft.mode} onChange={form.selectMode} layout="stack" showRequirements />
          </div>

          <div className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-expanded={showAdvanced}
              aria-controls="automation-toggles"
              onClick={() => {
                setShowAdvanced((open) => !open);
              }}
            >
              <ChevronRightIcon className={cn("size-4 transition-transform", showAdvanced && "rotate-90")} />
              Tuỳ chỉnh tính năng tự động
              {isCustomized(form.draft) ? <Badge variant="secondary">Đã tuỳ chỉnh</Badge> : null}
              <span className="ml-auto font-normal text-muted-foreground tabular-nums">
                {enabledCount(form.draft.automationSettings)} / {SETTING_KEYS.length} đang bật
              </span>
            </button>
            {showAdvanced ? (
              <div id="automation-toggles" className="border-t p-4">
                <AutomationToggles settings={form.draft.automationSettings} onToggle={form.toggle} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4">
          {form.error ? <p className="mr-auto text-sm text-destructive">{form.error}</p> : null}
          <Button variant="outline" asChild>
            <Link href="/">Huỷ</Link>
          </Button>
          <Button type="submit" disabled={form.submitting}>
            {form.submitting ? "Đang tạo…" : "Tạo dự án"}
          </Button>
        </div>
      </form>
    </div>
  );
}
