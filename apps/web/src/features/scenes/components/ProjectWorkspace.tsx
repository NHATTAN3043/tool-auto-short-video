"use client";

import { hasVoiceConflict, projectLanguage, type MediaAsset, type Project } from "@studio/domain";
import {
  ArrowLeftIcon,
  AudioLinesIcon,
  CaptionsIcon,
  ClapperboardIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  ImagesIcon,
  SparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type KeyboardEvent, type ReactNode } from "react";

import { AiAssistantPanel } from "@/features/ai";
import { FullAiLock, FullAiPanel, useFullAi } from "@/features/full-ai";
import { AudioSettings, MediaLibrary } from "@/features/media";
import { SceneMediaSearch, SharedMediaLibrary } from "@/features/media-search";
import { PreviewPanel, StyleSettings, usePreview, WatermarkSettings } from "@/features/preview";
import { MODE_LABELS, ProjectSettingsDialog } from "@/features/project";
import { RenderPanel } from "@/features/render";
import { copySfxToProject, SfxLibraryPanel, useSfxLibrary } from "@/features/sfx";
import {
  SceneVoiceControls,
  voiceStarter,
  useVoiceCatalog,
  useVoiceJobs,
  VoiceConfirmDialog,
  VoicePanel,
  VoiceTrackChooser,
} from "@/features/voice";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { useProjectEditor } from "../hooks/use-project-editor";
import { isSceneReady, sceneReadiness } from "../readiness";
import { SaveIndicator } from "./SaveIndicator";
import { SceneList } from "./SceneList";
import { ScriptPanel } from "./ScriptPanel";

type WorkspaceTab = "scenes" | "script" | "library" | "audio" | "captions" | "ai";

const TABS: readonly { id: WorkspaceTab; label: string; icon: LucideIcon }[] = [
  { id: "scenes", label: "Cảnh", icon: ClapperboardIcon },
  { id: "script", label: "Script", icon: FileTextIcon },
  { id: "library", label: "Thư viện", icon: ImagesIcon },
  { id: "audio", label: "Âm thanh", icon: AudioLinesIcon },
  { id: "captions", label: "Phụ đề & logo", icon: CaptionsIcon },
  { id: "ai", label: "Trợ lý AI", icon: SparklesIcon },
];

/**
 * Every tab stays mounted and only the active one is shown: switching tabs never cancels an upload, a voice
 * job poll or a half-typed field inside a panel.
 */
function TabPanel({ id, active, children }: { id: WorkspaceTab; active: WorkspaceTab; children: ReactNode }) {
  return (
    <div
      id={`tab-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={id !== active}
      className="flex min-w-0 flex-col gap-4"
    >
      {children}
    </div>
  );
}

export function ProjectWorkspace({
  project: initial,
  ttsAvailable,
  aiAvailable,
}: {
  project: Project;
  /** An AI provider is configured on the server (ANTHROPIC_API_KEY). */
  aiAvailable: boolean;
  /** A TTS provider is configured on the server (ELEVENLABS_API_KEY). */
  ttsAvailable: boolean;
}) {
  const editor = useProjectEditor(initial);
  // The toggle, never the mode name, decides; without a key the feature stays hidden.
  const voiceEnabled = ttsAvailable && editor.project.automationSettings.voiceGeneration;
  const voiceCatalog = useVoiceCatalog(voiceEnabled);
  const { scriptGeneration, scenePlanning, visualKeywords } = editor.project.automationSettings;
  const aiEnabled = aiAvailable && (scriptGeneration || scenePlanning || visualKeywords);
  const rankingEnabled = aiAvailable && editor.project.automationSettings.mediaRanking;
  const voiceJobs = useVoiceJobs(editor.project.id, voiceEnabled, editor.flushSave, editor.voicesGenerated);
  const startVoice = voiceStarter(voiceCatalog.catalog, editor.saveVoiceSettings);
  const preview = usePreview(editor.project);
  const sfxLibrary = useSfxLibrary();
  const projectId = editor.project.id;
  const { assetAdded, addSfx, assignMedia } = editor;
  const pickMedia = useCallback(
    (sceneId: string, asset: MediaAsset) => {
      assetAdded(asset);
      assignMedia(sceneId, asset.id);
    },
    [assetAdded, assignMedia],
  );
  const router = useRouter();
  const openReview = useCallback(() => {
    router.push(`/projects/${encodeURIComponent(projectId)}/review`);
  }, [router, projectId]);
  // The worker edits the project during a Full AI run: the editor is locked, then the review opens.
  const fullAi = useFullAi(projectId, aiAvailable, editor.flushSave, openReview);
  const addSfxFromLibrary = useCallback(
    async (sceneId: string, librarySfxId: string) => {
      const asset = await copySfxToProject(projectId, librarySfxId);
      assetAdded(asset);
      addSfx(sceneId, asset.id);
    },
    [projectId, assetAdded, addSfx],
  );

  const [tab, setTab] = useState<WorkspaceTab>("scenes");
  const tabs = TABS.filter((item) => item.id !== "ai" || aiAvailable);
  const scenesNeedWork = editor.project.scenes.some(
    (scene) => !isSceneReady(sceneReadiness(editor.project, scene, voiceEnabled)),
  );
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = tabs.findIndex((item) => item.id === tab);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-3 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/" aria-label="Về danh sách dự án" title="Về danh sách dự án">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              Dự án · {MODE_LABELS[editor.project.mode].title}
            </div>
            <h1 className="truncate text-lg leading-tight font-semibold" title={editor.project.name}>
              {editor.project.name}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator
            status={editor.saveStatus}
            canUndo={editor.canUndo}
            onUndo={editor.undo}
            onRetry={editor.retrySave}
          />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ProjectSettingsDialog project={editor.project} onSave={editor.saveSettings} />
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${encodeURIComponent(projectId)}/review`}>
              <ClipboardCheckIcon />
              Duyệt cảnh
            </Link>
          </Button>
        </div>
      </div>

      <div className="border-b bg-background px-4 lg:px-6">
        <div
          role="tablist"
          aria-label="Khu vực làm việc"
          className="scrollbar-clean -mb-px flex gap-1 overflow-x-auto"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`tab-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                tab === id && "border-primary font-medium text-foreground",
              )}
              onClick={() => {
                setTab(id);
              }}
              onKeyDown={onTabKeyDown}
            >
              <Icon className="size-4" />
              {label}
              {id === "scenes" ? (
                <>
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                    {editor.project.scenes.length}
                  </span>
                  {scenesNeedWork ? (
                    <span className="size-1.5 rounded-full bg-warning" title="Có cảnh cần xử lý" />
                  ) : null}
                </>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 lg:p-6">
        {fullAi.state.step === "running" ? <FullAiLock job={fullAi.state.job} /> : null}

        {editor.lastError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            {editor.lastError}
            <Button variant="ghost" size="icon-xs" aria-label="Đóng" onClick={editor.dismissError}>
              <XIcon />
            </Button>
          </div>
        ) : null}

        {hasVoiceConflict(editor.project) ? (
          <VoiceTrackChooser project={editor.project} onChange={editor.setVoiceTrack} />
        ) : null}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <TabPanel id="scenes" active={tab}>
              <SceneList
                project={editor.project}
                sfxLibrary={sfxLibrary.items}
                timeline={editor.timeline}
                voiceRequired={voiceEnabled}
                onInsertFirst={() => {
                  editor.insertAfter(null);
                }}
                onOpenScript={() => {
                  setTab("script");
                }}
                renderMediaSearch={(scene, sceneLabel) => (
                  <SceneMediaSearch
                    projectId={editor.project.id}
                    sceneLabel={sceneLabel}
                    visualPlan={scene.visualPlan}
                    narration={scene.narration}
                    language={projectLanguage(editor.project)}
                    keywordSuggest={
                      aiAvailable
                        ? {
                            sceneId: scene.id,
                            script: editor.project.script,
                            onApply: editor.applyVisualPlans,
                          }
                        : null
                    }
                    onPicked={(asset) => {
                      pickMedia(scene.id, asset);
                    }}
                    ranking={
                      rankingEnabled
                        ? {
                            sceneId: scene.id,
                            narration: scene.narration,
                            ...(scene.visualPlan?.intent && { intent: scene.visualPlan.intent }),
                            mode: editor.project.mediaRankingMode ?? "text",
                            onModeChange: editor.setMediaRankingMode,
                          }
                        : null
                    }
                  />
                )}
                renderVoice={(scene) => (
                  <SceneVoiceControls
                    project={editor.project}
                    scene={scene}
                    jobs={voiceJobs}
                    generationEnabled={voiceEnabled}
                    startVoice={startVoice}
                    picker={{
                      onChange: (voiceAssetId) => {
                        editor.setSceneVoice(scene.id, voiceAssetId);
                      },
                      onAssetAdded: editor.assetAdded,
                    }}
                  />
                )}
                actions={{
                  onNarrationChange: editor.editNarration,
                  onNarrationBlur: editor.commitTyping,
                  onDurationCommit: editor.setDuration,
                  onInsertAfter: editor.insertAfter,
                  onDelete: editor.deleteScene,
                  onMove: editor.moveScene,
                  onSplit: editor.splitScene,
                  onMergeNext: editor.mergeWithNext,
                  onAssignMedia: editor.assignMedia,
                  onMediaChange: editor.updateMedia,
                  onClearMedia: editor.clearMedia,
                  onMediaCommit: editor.commitTyping,
                  onAddSfx: addSfxFromLibrary,
                  onSfxChange: editor.updateSfx,
                  onRemoveSfx: editor.removeSfx,
                  onPreviewScene: preview.seekToScene,
                  onVisualPlanChange: editor.setVisualPlan,
                }}
              />
            </TabPanel>

            <TabPanel id="script" active={tab}>
              <ScriptPanel
                script={editor.project.script}
                sceneCount={editor.project.scenes.length}
                onScriptChange={editor.setScript}
                onScriptBlur={editor.commitTyping}
                onSplit={editor.splitScript}
              />
            </TabPanel>

            <TabPanel id="library" active={tab}>
              <MediaLibrary
                projectId={editor.project.id}
                assets={editor.project.assets}
                onUploaded={editor.assetAdded}
              />
              <SharedMediaLibrary />
              <SfxLibraryPanel library={sfxLibrary} />
            </TabPanel>

            <TabPanel id="audio" active={tab}>
              <AudioSettings
                projectId={editor.project.id}
                assets={editor.project.assets}
                voiceAssetId={editor.project.voiceAssetId}
                music={editor.project.music}
                onVoiceChange={editor.setVoice}
                onMusicChange={editor.setMusic}
                onCommit={editor.commitTyping}
              />
              {voiceEnabled ? (
                <VoicePanel
                  project={editor.project}
                  catalog={voiceCatalog}
                  jobs={voiceJobs}
                  onSettingsChange={editor.setVoiceSettings}
                  onLanguageChange={editor.setLanguage}
                  onCommit={editor.commitTyping}
                />
              ) : null}
            </TabPanel>

            <TabPanel id="captions" active={tab}>
              <StyleSettings
                style={editor.project.style}
                onChange={editor.updateStyle}
                onCommit={editor.commitTyping}
              />
              <WatermarkSettings
                projectId={editor.project.id}
                assets={editor.project.assets}
                watermark={editor.project.style.watermark}
                onAssetAdded={editor.assetAdded}
                onChange={editor.updateStyle}
                onCommit={editor.commitTyping}
              />
            </TabPanel>

            {aiAvailable ? (
              <TabPanel id="ai" active={tab}>
                <FullAiPanel
                  project={editor.project}
                  ttsAvailable={ttsAvailable}
                  beforeOpen={editor.flushSave}
                />
                {aiEnabled ? (
                  <AiAssistantPanel
                    project={editor.project}
                    onApplyScript={editor.applyScript}
                    onApplyScenePlan={editor.applyScenePlan}
                    onApplyVisualPlans={editor.applyVisualPlans}
                  />
                ) : null}
              </TabPanel>
            ) : null}
          </div>

          {/* The preview stays in view while working through the scenes. */}
          <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
            <PreviewPanel
              preview={preview.preview}
              hasScenes={editor.project.scenes.length > 0}
              playerRef={preview.playerRef}
            />
            <RenderPanel project={editor.project} flushSave={editor.flushSave} />
          </aside>
        </div>
      </div>

      <VoiceConfirmDialog project={editor.project} jobs={voiceJobs} />
    </div>
  );
}
