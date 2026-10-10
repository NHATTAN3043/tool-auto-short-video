"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { useCreateProjectForm } from "../hooks/use-create-project-form";
import { isCustomized } from "../model";
import { AutomationToggles } from "./AutomationToggles";
import { ModePicker } from "./ModePicker";

export function CreateProjectForm() {
  const form = useCreateProjectForm();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tạo dự án mới</CardTitle>
        <CardDescription>Video dọc 1080×1920 cho TikTok, YouTube Shorts và Facebook Reels.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
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
            <Label>Chế độ</Label>
            <ModePicker value={form.draft.mode} onChange={form.selectMode} />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="flex items-center gap-2 self-start text-sm font-medium"
              aria-expanded={showAdvanced}
              onClick={() => {
                setShowAdvanced((open) => !open);
              }}
            >
              <ChevronDown className={cn("size-4 transition-transform", showAdvanced && "rotate-180")} />
              Tuỳ chỉnh nâng cao
              {isCustomized(form.draft) ? <Badge variant="secondary">Đã tuỳ chỉnh</Badge> : null}
            </button>
            {showAdvanced ? (
              <AutomationToggles settings={form.draft.automationSettings} onToggle={form.toggle} />
            ) : null}
          </div>

          {form.error ? <p className="text-sm text-destructive">{form.error}</p> : null}
          <Button type="submit" disabled={form.submitting} className="self-end">
            {form.submitting ? "Đang tạo…" : "Tạo dự án"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
