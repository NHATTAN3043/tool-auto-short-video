"use client";

import type { Project } from "@studio/domain";
import { Settings2Icon } from "lucide-react";
import { useEffect, useState } from "react";

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

import { fetchAiProviderCatalog, type AiProviderCatalog } from "../api";
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
  const [catalog, setCatalog] = useState<AiProviderCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAiProviderCatalog().then(
      (value) => {
        if (active) setCatalog(value);
      },
      () => {
        if (active) setCatalogError("Không tải được danh sách nhà cung cấp AI.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const legacy = catalog?.providers.find((provider) => provider.id === "claude");
  const selected =
    settings.draft.ai ??
    (legacy
      ? { provider: "claude" as const, model: legacy.defaultModel }
      : { provider: "claude" as const, model: "" });
  const selectedProvider = catalog?.providers.find((provider) => provider.id === selected.provider);
  const aiError =
    catalog === null
      ? catalogError
      : !selectedProvider?.configured
        ? `Chưa cấu hình API key cho ${selectedProvider?.label ?? selected.provider}.`
        : !selectedProvider.models.includes(selected.model)
          ? "Model đã chọn không nằm trong danh sách model được phép."
          : null;

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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-provider">Nhà cung cấp AI</Label>
            <select
              id="ai-provider"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={selected.provider}
              disabled={catalog === null}
              onChange={(event) => {
                const provider = catalog?.providers.find((item) => item.id === event.target.value);
                if (provider) settings.setAi({ provider: provider.id, model: provider.defaultModel });
              }}
            >
              {(catalog?.providers ?? []).map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                  {provider.label}
                  {provider.configured ? "" : " — chưa cấu hình key"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-model">Model</Label>
            <select
              id="ai-model"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={selected.model}
              disabled={!selectedProvider?.configured}
              onChange={(event) => {
                settings.setAi({ provider: selected.provider, model: event.target.value });
              }}
            >
              {!selectedProvider?.models.includes(selected.model) && selected.model !== "" ? (
                <option value={selected.model}>{selected.model} — không còn khả dụng</option>
              ) : null}
              {(selectedProvider?.models ?? []).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
          {selectedProvider?.warning ? (
            <p className="text-sm text-amber-700 sm:col-span-2">{selectedProvider.warning}</p>
          ) : null}
          {aiError ? <p className="text-sm text-destructive sm:col-span-2">{aiError}</p> : null}
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
          disabled={
            !settings.dirty || settings.nameError !== null || aiError !== null || settings.status === "saving"
          }
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
