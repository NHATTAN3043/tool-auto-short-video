"use client";

import {
  projectLanguage,
  scenesNeedingLoudness,
  type ContentLanguage,
  type Project,
  type VoiceSettings,
} from "@studio/domain";
import { AudioLinesIcon, MicIcon, RefreshCwIcon } from "lucide-react";
import { useId } from "react";

import { LanguageSelect } from "@/features/project";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Slider } from "@/shared/ui/slider";

import type { VoiceCatalogState } from "../hooks/use-voice-catalog";
import type { VoiceJobsState } from "../hooks/use-voice-jobs";
import { initialVoiceSettings, sceneNumbers, VOICE_LIMITS, voiceOptionLabel, voiceOverview } from "../model";
import { VoicePreview } from "./VoicePreview";

const SELECT_CLASS =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function TuningRow({
  label,
  value,
  limits,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  limits: { min: number; max: number; step: number };
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <Slider
        {...limits}
        value={[value]}
        thumbLabels={[label]}
        onValueChange={([next = value]) => {
          onChange(Math.round(next * 100) / 100);
        }}
        onValueCommit={onCommit}
      />
      <span className="w-12 text-right font-mono text-sm">{value.toFixed(2).replace(".", ",")}</span>
    </div>
  );
}

/** AI voice of the scenes: which voice and how it sounds, and the "generate changed voices" action. */
export function VoicePanel({
  project,
  catalog,
  jobs,
  onSettingsChange,
  onLanguageChange,
  onCommit,
}: {
  project: Project;
  catalog: VoiceCatalogState;
  jobs: VoiceJobsState;
  onSettingsChange: (settings: VoiceSettings) => void;
  /** Sets the project language, shared with Full AI: the voice is told to read in it. */
  onLanguageChange: (language: ContentLanguage) => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
}) {
  const voiceSelectId = useId();
  const modelSelectId = useId();
  const settings = project.voice;
  const overview = voiceOverview(project);
  const unbalanced = scenesNeedingLoudness(project);
  const loaded = catalog.catalog;
  const initial = loaded ? initialVoiceSettings(loaded) : null;
  const knownVoice = loaded?.voices.some((voice) => voice.id === settings?.voiceId) ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Giọng đọc AI</CardTitle>
        <CardDescription>
          Tạo giọng riêng cho từng cảnh. Chỉ cảnh mới hoặc đã đổi lời được tạo lại, các file giọng khác giữ
          nguyên.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {catalog.error ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            {catalog.error}
            <Button variant="outline" size="sm" onClick={catalog.retry}>
              <RefreshCwIcon />
              Thử lại
            </Button>
          </div>
        ) : null}
        {catalog.loading ? <p className="text-sm text-muted-foreground">Đang tải danh sách giọng…</p> : null}

        {loaded && !settings ? (
          initial ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => {
                  onSettingsChange(initial);
                }}
              >
                <MicIcon />
                Chọn giọng đọc cho dự án
              </Button>
              <span className="text-sm text-muted-foreground">
                Bắt đầu với giọng mặc định, đổi được ngay sau đó.
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tài khoản ElevenLabs chưa có giọng nào. Thêm giọng trong ElevenLabs rồi tải lại trang.
            </p>
          )
        ) : null}

        {loaded && settings ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={voiceSelectId}>Giọng</Label>
              <select
                id={voiceSelectId}
                className={SELECT_CLASS}
                value={settings.voiceId}
                onChange={(event) => {
                  onSettingsChange({ ...settings, voiceId: event.target.value });
                }}
              >
                {knownVoice ? null : (
                  <option value={settings.voiceId}>{settings.voiceId} (không còn trong tài khoản)</option>
                )}
                {loaded.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voiceOptionLabel(voice)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={modelSelectId}>Model</Label>
              <select
                id={modelSelectId}
                className={SELECT_CLASS}
                value={settings.modelId}
                onChange={(event) => {
                  onSettingsChange({ ...settings, modelId: event.target.value });
                }}
              >
                {loaded.models.some((model) => model.id === settings.modelId) ? null : (
                  <option value={settings.modelId}>{settings.modelId}</option>
                )}
                {loaded.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {String(model.creditsPerCharacter).replace(".", ",")} credit/ký tự
                  </option>
                ))}
              </select>
            </div>
            <LanguageSelect
              label="Ngôn ngữ đọc"
              value={projectLanguage(project)}
              onChange={onLanguageChange}
            />
            <div className="flex flex-col gap-2 md:col-span-2">
              <TuningRow
                label="Ổn định"
                value={settings.stability}
                limits={VOICE_LIMITS.stability}
                onChange={(stability) => {
                  onSettingsChange({ ...settings, stability });
                }}
                onCommit={onCommit}
              />
              <TuningRow
                label="Giống giọng gốc"
                value={settings.similarityBoost}
                limits={VOICE_LIMITS.similarityBoost}
                onChange={(similarityBoost) => {
                  onSettingsChange({ ...settings, similarityBoost });
                }}
                onCommit={onCommit}
              />
              <TuningRow
                label="Tốc độ"
                value={settings.speed}
                limits={VOICE_LIMITS.speed}
                onChange={(speed) => {
                  onSettingsChange({ ...settings, speed });
                }}
                onCommit={onCommit}
              />
              <VoicePreview project={project} settings={settings} catalog={loaded} />
              <p className="text-xs text-muted-foreground">
                Đổi giọng, model, ngôn ngữ hoặc các thanh trên sẽ đánh dấu mọi giọng đã tạo là “Lời đã đổi”.
              </p>
            </div>
          </div>
        ) : null}

        {settings ? (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              disabled={overview.needed.length === 0 || jobs.running || jobs.busy}
              onClick={() => {
                void jobs.prepare();
              }}
            >
              <MicIcon />
              Tạo cho cảnh đã đổi ({overview.needed.length})
            </Button>
            <span className="text-sm text-muted-foreground">
              {overview.needed.length === 0
                ? "Mọi cảnh có lời đều đã có giọng khớp."
                : `Cảnh ${sceneNumbers(project, overview.needed)}: ${String(overview.missing)} chưa có giọng, ${String(overview.outdated)} đã đổi lời.`}
            </span>
          </div>
        ) : null}

        {unbalanced.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              variant="outline"
              disabled={jobs.running || jobs.busy}
              onClick={() => {
                void jobs.balanceLoudness();
              }}
            >
              <AudioLinesIcon />
              Cân bằng âm lượng ({unbalanced.length})
            </Button>
            <span className="text-sm text-muted-foreground">
              Miễn phí. Đưa giọng AI của cảnh {sceneNumbers(project, unbalanced)} về cùng một độ to; giọng cũ
              vẫn giữ để chọn lại.
            </span>
          </div>
        ) : null}

        {jobs.job && jobs.running ? (
          <p className="text-sm" role="status">
            {jobs.job.voice?.normalizeOnly === true
              ? jobs.job.status === "QUEUED"
                ? "Đang chờ worker cân bằng âm lượng…"
                : `Đang cân bằng âm lượng cảnh ${sceneNumbers(project, jobs.job.sceneIds ?? [])}… ${String(Math.round(jobs.job.progress * 100))}%`
              : jobs.job.status === "QUEUED"
                ? "Đang chờ worker tạo giọng…"
                : `Đang tạo giọng cảnh ${sceneNumbers(project, jobs.job.sceneIds ?? [])}… ${String(Math.round(jobs.job.progress * 100))}%`}
          </p>
        ) : null}
        {jobs.error ? (
          <p className="text-sm text-destructive" role="alert">
            {jobs.error}
          </p>
        ) : null}
        {project.voiceAssetId !== undefined ? (
          <p className="text-xs text-muted-foreground">
            Dự án đang có voice chung. Khi có cả hai, chỉ một loại được phát: chọn ở mục “Voice được phát”.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
