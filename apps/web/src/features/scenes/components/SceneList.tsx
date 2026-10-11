"use client";

import type { LibrarySfx, Project, Scene, TimelineEntry } from "@studio/domain";
import { ClapperboardIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import { SceneCard, type SceneCardActions } from "./SceneCard";
import { SceneNavList } from "./SceneNavList";

/**
 * Which scene is open. Follows a scene that was just added (insert, split) and, when the open scene is
 * deleted, stays at the same position. UI state only: the project is never touched here.
 */
function useSelectedScene(scenes: readonly Scene[]) {
  const ids = scenes.map((scene) => scene.id);
  const [selectedId, setSelectedId] = useState<string | null>(ids[0] ?? null);
  const [seen, setSeen] = useState<{ ids: readonly string[]; index: number }>({ ids, index: 0 });

  // Adjusting state while rendering (not in an effect) so the new scene opens in the same paint.
  let current = selectedId;
  if (seen.ids.join("|") !== ids.join("|")) {
    const before = new Set(seen.ids);
    const added = ids.filter((id) => !before.has(id));
    if (added.length === 1 && added[0] !== undefined) current = added[0];
    else if (current === null || !ids.includes(current)) {
      current = ids[Math.min(seen.index, ids.length - 1)] ?? null;
    }
    setSelectedId(current);
    setSeen({ ids, index: Math.max(0, ids.indexOf(current ?? "")) });
  }

  const index = current === null ? -1 : ids.indexOf(current);
  return {
    selectedIndex: index === -1 && ids.length > 0 ? 0 : index,
    select: (sceneId: string) => {
      setSelectedId(sceneId);
      setSeen({ ids, index: Math.max(0, ids.indexOf(sceneId)) });
    },
  };
}

export function SceneList({
  project,
  sfxLibrary,
  timeline,
  voiceRequired,
  actions,
  onInsertFirst,
  onOpenScript,
  renderVoice,
  renderMediaSearch,
}: {
  project: Project;
  sfxLibrary: readonly LibrarySfx[];
  timeline: readonly TimelineEntry[];
  /** Per-scene voices are expected, so a scene without one is flagged as not ready. */
  voiceRequired: boolean;
  actions: SceneCardActions;
  onInsertFirst: () => void;
  /** Shows the Script tab, from the empty state. */
  onOpenScript: () => void;
  renderVoice?: (scene: Scene) => ReactNode;
  renderMediaSearch?: (scene: Scene, sceneLabel: string) => ReactNode;
}) {
  const { scenes } = project;
  const { selectedIndex, select } = useSelectedScene(scenes);

  if (scenes.length === 0) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <ClapperboardIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Chưa có cảnh nào</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Dán script rồi tách thành cảnh, hoặc thêm từng cảnh trống để tự viết lời.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onOpenScript}>
            <FileTextIcon />
            Mở Script
          </Button>
          <Button variant="outline" onClick={onInsertFirst}>
            <PlusIcon />
            Thêm cảnh trống
          </Button>
        </div>
      </section>
    );
  }

  const scene = scenes[selectedIndex];
  const entry = timeline[selectedIndex];
  const lastScene = scenes[scenes.length - 1];

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <SceneNavList
        project={project}
        timeline={timeline}
        voiceRequired={voiceRequired}
        selectedId={scene?.id ?? null}
        onSelect={select}
        onAppend={() => {
          if (lastScene) actions.onInsertAfter(lastScene.id);
          else onInsertFirst();
        }}
        className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
      />
      {scene && entry ? (
        <SceneCard
          key={scene.id}
          projectId={project.id}
          assets={project.assets}
          sfxLibrary={sfxLibrary}
          scene={scene}
          entry={entry}
          isFirst={selectedIndex === 0}
          isLast={selectedIndex === scenes.length - 1}
          actions={actions}
          voiceSlot={renderVoice?.(scene)}
          mediaSearchSlot={renderMediaSearch?.(scene, `Cảnh ${String(selectedIndex + 1)}`)}
        />
      ) : null}
    </div>
  );
}
