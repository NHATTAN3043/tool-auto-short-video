"use client";

import type { Project } from "@studio/domain";
import { Settings2Icon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
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

/**
 * The settings form. Mounted only while the dialog is open, so every opening starts from the saved project
 * and closing without "Lưu" drops the draft.
 */
function ProjectSettingsForm({
  project,
  onSave,
}: {
  project: Project;
  onSave: (settings: ProjectSettingsDraft) => Promise<void>;
}) {
  const settings = useProjectSettings(project, onSave);

  return (
    <>
      <DialogBody className="flex flex-col gap-6">
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

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-destructive/30 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Xoá dự án</span>
            <span className="text-sm text-muted-foreground">
              Xoá cả cảnh, media, giọng và video đã render. Không khôi phục được.
            </span>
          </div>
          <DeleteProjectButton project={project} after="home" />
        </div>
      </DialogBody>

      <DialogFooter>
        {settings.error ? <p className="mr-auto text-sm text-destructive">{settings.error}</p> : null}
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {statusText(settings.status, settings.dirty)}
        </span>
        <DialogClose asChild>
          <Button variant="outline">Đóng</Button>
        </DialogClose>
        <Button
          disabled={!settings.dirty || settings.nameError !== null || settings.status === "saving"}
          onClick={() => {
            void settings.save();
          }}
        >
          Lưu
        </Button>
      </DialogFooter>
    </>
  );
}

/** "Cài đặt" button of the workspace header: name, mode, automation toggles and deletion in a dialog. */
export function ProjectSettingsDialog({
  project,
  onSave,
}: {
  project: Project;
  onSave: (settings: ProjectSettingsDraft) => Promise<void>;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2Icon />
          Cài đặt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cài đặt dự án</DialogTitle>
          <DialogDescription>
            Chế độ chỉ là bộ cài đặt sẵn; từng công tắc bên dưới mới quyết định tính năng nào bật.
          </DialogDescription>
        </DialogHeader>
        <ProjectSettingsForm project={project} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}
