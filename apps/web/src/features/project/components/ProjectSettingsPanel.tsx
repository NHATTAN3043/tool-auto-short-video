"use client";

import type { Project } from "@studio/domain";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { useProjectSettings, type SaveStatus } from "../hooks/use-project-settings";
import { MODE_LABELS } from "../labels";
import type { ProjectSettingsDraft } from "../model";
import { AutomationToggles } from "./AutomationToggles";
import { DeleteProjectButton } from "./DeleteProjectButton";
import { ModePicker } from "./ModePicker";

function statusText(status: SaveStatus, dirty: boolean): string {
  if (status === "saving") return "Đang lưu…";
  if (dirty) return "Có thay đổi chưa lưu";
  return status === "saved" ? "Đã lưu" : "";
}

export function ProjectSettingsPanel({
  project,
  onSave,
}: {
  project: Project;
  onSave: (settings: ProjectSettingsDraft) => Promise<void>;
}) {
  const settings = useProjectSettings(project, onSave);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cài đặt dự án</CardTitle>
        <CardDescription>
          Chế độ chỉ là bộ cài đặt sẵn; từng công tắc bên dưới mới quyết định tính năng nào bật.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name">Tên dự án</Label>
          <Input
            id="project-name"
            value={settings.draft.name}
            aria-invalid={settings.nameError !== null}
            onChange={(event) => {
              settings.setName(event.target.value);
            }}
          />
          {settings.nameError ? <p className="text-sm text-destructive">{settings.nameError}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Chế độ</Label>
          <ModePicker value={settings.draft.mode} onChange={settings.selectMode} />
          {settings.presetNotice ? (
            <p className="text-sm text-muted-foreground">
              Đã áp dụng cài đặt mặc định của chế độ “{MODE_LABELS[settings.presetNotice].title}”. Bạn vẫn có
              thể chỉnh từng công tắc.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Tính năng tự động</Label>
          <AutomationToggles settings={settings.draft.automationSettings} onToggle={settings.toggle} />
        </div>

        {settings.error ? <p className="text-sm text-destructive">{settings.error}</p> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="mr-auto">
            <DeleteProjectButton project={project} after="home" />
          </div>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {statusText(settings.status, settings.dirty)}
          </span>
          <Button
            disabled={!settings.dirty || settings.nameError !== null || settings.status === "saving"}
            onClick={() => {
              void settings.save();
            }}
          >
            Lưu
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
