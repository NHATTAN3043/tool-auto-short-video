"use client";

import { hasVoiceConflict, type MediaAsset, type Project } from "@studio/domain";
import { ClipboardCheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { AiAssistantPanel } from "@/features/ai";
import { FullAiLock, FullAiPanel, useFullAi } from "@/features/full-ai";
import { AudioSettings, MediaLibrary } from "@/features/media";
import { SceneMediaSearch, SharedMediaLibrary } from "@/features/media-search";
import { PreviewPanel, StyleSettings, usePreview } from "@/features/preview";
import { ProjectSettingsPanel } from "@/features/project";
import { RenderPanel } from "@/features/render";
import { copySfxToProject, SfxLibraryPanel, useSfxLibrary } from "@/features/sfx";
import {
  SceneVoiceControls,
  useVoiceCatalog,
  useVoiceJobs,
  VoiceConfirmDialog,
  VoicePanel,
  VoiceTrackChooser,
} from "@/features/voice";
import { Button } from "@/shared/ui/button";

import { useProjectEditor } from "../hooks/use-project-editor";
import { SaveIndicator } from "./SaveIndicator";
import { SceneList } from "./SceneList";
import { ScriptPanel } from "./ScriptPanel";

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

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-background/95 py-2 backdrop-blur">
        <h1 className="text-2xl font-semibold">{editor.project.name}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${encodeURIComponent(projectId)}/review`}>
              <ClipboardCheckIcon />
              Duyệt cảnh
            </Link>
          </Button>
          <SaveIndicator
            status={editor.saveStatus}
            canUndo={editor.canUndo}
            onUndo={editor.undo}
            onRetry={editor.retrySave}
          />
        </div>
      </div>
      {fullAi.state.step === "running" ? <FullAiLock job={fullAi.state.job} /> : null}

      {editor.lastError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {editor.lastError}
          <Button variant="ghost" size="icon-xs" aria-label="Đóng" onClick={editor.dismissError}>
            <XIcon />
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ProjectSettingsPanel project={editor.project} onSave={editor.saveSettings} />

          <ScriptPanel
            script={editor.project.script}
            sceneCount={editor.project.scenes.length}
            onScriptChange={editor.setScript}
            onScriptBlur={editor.commitTyping}
            onSplit={editor.splitScript}
          />

          {aiAvailable ? (
            <FullAiPanel
              project={editor.project}
              ttsAvailable={ttsAvailable}
              controller={fullAi}
              onRankingModeChange={editor.setMediaRankingMode}
            />
          ) : null}

          {aiEnabled ? (
            <AiAssistantPanel
              project={editor.project}
              onApplyScript={editor.applyScript}
              onApplyScenePlan={editor.applyScenePlan}
              onApplyVisualPlans={editor.applyVisualPlans}
            />
          ) : null}

          <MediaLibrary
            projectId={editor.project.id}
            assets={editor.project.assets}
            onUploaded={editor.assetAdded}
          />

          <AudioSettings
            projectId={editor.project.id}
            assets={editor.project.assets}
            voiceAssetId={editor.project.voiceAssetId}
            music={editor.project.music}
            onVoiceChange={editor.setVoice}
            onMusicChange={editor.setMusic}
            onCommit={editor.commitTyping}
          />

          {hasVoiceConflict(editor.project) ? (
            <VoiceTrackChooser project={editor.project} onChange={editor.setVoiceTrack} />
          ) : null}

          {voiceEnabled ? (
            <VoicePanel
              project={editor.project}
              catalog={voiceCatalog}
              jobs={voiceJobs}
              onSettingsChange={editor.setVoiceSettings}
              onCommit={editor.commitTyping}
            />
          ) : null}

          <SharedMediaLibrary />

          <SfxLibraryPanel library={sfxLibrary} />

          <StyleSettings
            style={editor.project.style}
            onChange={editor.updateStyle}
            onCommit={editor.commitTyping}
          />

          <SceneList
            projectId={editor.project.id}
            assets={editor.project.assets}
            sfxLibrary={sfxLibrary.items}
            scenes={editor.project.scenes}
            timeline={editor.timeline}
            onInsertFirst={() => {
              editor.insertAfter(null);
            }}
            renderMediaSearch={(scene, sceneLabel) => (
              <SceneMediaSearch
                projectId={editor.project.id}
                sceneLabel={sceneLabel}
                visualPlan={scene.visualPlan}
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
        </div>

        {/* Below the header bar, so the preview stays in view while scrolling through scenes. */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
          <PreviewPanel
            preview={preview.preview}
            hasScenes={editor.project.scenes.length > 0}
            playerRef={preview.playerRef}
          />
          <RenderPanel project={editor.project} flushSave={editor.flushSave} />
        </aside>
      </div>

      <VoiceConfirmDialog project={editor.project} jobs={voiceJobs} />
    </div>
  );
}
