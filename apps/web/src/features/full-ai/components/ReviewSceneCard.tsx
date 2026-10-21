"use client";

import type { MediaAsset, MediaCandidate, Project, Scene } from "@studio/domain";
import { CheckIcon, ImagesIcon, PenLineIcon, Undo2Icon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { projectFileUrl } from "@/features/media/api";
import { importCandidate } from "@/features/media-search/api";
import { linkUrl, SOURCE_LABELS } from "@/features/media-search/model";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

function MediaThumbnail({ project, scene }: { project: Project; scene: Scene }) {
  const asset = project.assets.find((candidate) => candidate.id === scene.media?.assetId);
  const path = asset?.thumbnailPath ?? (asset?.kind === "image" ? asset.path : undefined);
  if (!asset || path === undefined) {
    return (
      <div className="flex aspect-[9/16] w-24 shrink-0 items-center justify-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
        {asset ? asset.fileName : "Chưa có media"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the project files route
    <img
      src={projectFileUrl(project.id, path)}
      alt={`Media của cảnh: ${asset.fileName}`}
      className="aspect-[9/16] w-24 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

/** "Đổi media": the other candidates the AI ranked, one click to use instead. */
function Alternatives({
  projectId,
  scene,
  candidates,
  onPicked,
}: {
  projectId: string;
  scene: Scene;
  candidates: readonly MediaCandidate[];
  onPicked: (asset: MediaAsset) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">Không còn gợi ý nào khác; tìm thêm bên dưới.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {candidates.map((candidate) => {
          const key = `${candidate.provider}:${candidate.ref}`;
          return (
            <button
              key={key}
              type="button"
              disabled={busy !== null}
              title={candidate.description ?? key}
              className="relative overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary disabled:opacity-50"
              onClick={() => {
                setBusy(key);
                setError(null);
                importCandidate(
                  projectId,
                  { provider: candidate.provider, ref: candidate.ref, kind: candidate.kind },
                  scene.visualPlan?.searchQueries[0] ?? "full ai",
                )
                  .then(onPicked)
                  .catch((cause: unknown) => {
                    setError(errorText(cause));
                  })
                  .finally(() => {
                    setBusy(null);
                  });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied stock thumbnails */}
              <img
                src={linkUrl(candidate.thumbnail)}
                alt={candidate.description ?? `Ứng viên ${key}`}
                className="h-28 w-20 object-cover"
              />
              <span className="absolute bottom-0 left-0 bg-background/80 px-1 text-[10px]">
                {busy === key ? "Đang tải…" : SOURCE_LABELS[candidate.provider]}
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface ReviewSceneActions {
  onApprove: (sceneId: string, approved: boolean) => void;
  onMediaPicked: (sceneId: string, asset: MediaAsset) => void;
  /** Null when rewriting is not available (no AI or the scriptGeneration toggle is off). */
  onRewrite: ((sceneId: string, instruction: string) => void) | null;
}

/** One scene on the review screen: Giữ cảnh / Đổi media / Viết lại / Tạo lại giọng. */
export function ReviewSceneCard({
  project,
  scene,
  index,
  alternatives,
  actions,
  rewriteSuggestion,
  voice,
  mediaSearch,
}: {
  project: Project;
  scene: Scene;
  index: number;
  alternatives: readonly MediaCandidate[];
  actions: ReviewSceneActions;
  /** The AI rewrite waiting for review on this scene, with apply/discard buttons. */
  rewriteSuggestion: ReactNode;
  /** Voice status and "Tạo lại giọng". */
  voice: ReactNode;
  /** The full search panel, to look beyond the ranked candidates. */
  mediaSearch: ReactNode;
}) {
  const [changingMedia, setChangingMedia] = useState(false);
  const [instruction, setInstruction] = useState("");
  const instructionId = useId();
  const approved = scene.status === "approved";

  return (
    <Card className={approved ? "border-primary/60" : undefined}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            Cảnh {index + 1}
            <Badge variant={approved ? "default" : "secondary"}>{approved ? "Đã giữ" : "Chưa duyệt"}</Badge>
          </span>
          <Button
            size="sm"
            variant={approved ? "outline" : "default"}
            onClick={() => {
              actions.onApprove(scene.id, !approved);
            }}
          >
            {approved ? <Undo2Icon /> : <CheckIcon />}
            {approved ? "Bỏ giữ" : "Giữ cảnh"}
          </Button>
        </div>

        <div className="flex gap-3">
          <MediaThumbnail project={project} scene={scene} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm whitespace-pre-wrap">{scene.narration}</p>
            {scene.visualPlan?.intent ? (
              <p className="text-xs text-muted-foreground">Ý đồ hình: {scene.visualPlan.intent}</p>
            ) : null}
            {voice}
          </div>
        </div>

        {rewriteSuggestion}

        <div className="flex flex-wrap items-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setChangingMedia((open) => !open);
            }}
          >
            <ImagesIcon />
            {changingMedia ? "Đóng đổi media" : "Đổi media"}
          </Button>
          {actions.onRewrite ? (
            <>
              <Input
                id={instructionId}
                aria-label={`Yêu cầu khi viết lại cảnh ${String(index + 1)}`}
                className="h-8 w-56"
                maxLength={300}
                placeholder="Yêu cầu: ngắn hơn, vui hơn…"
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  actions.onRewrite?.(scene.id, instruction);
                }}
              >
                <PenLineIcon />
                Viết lại
              </Button>
            </>
          ) : null}
        </div>

        {changingMedia ? (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <span className="text-sm font-medium">Gợi ý khác của AI</span>
            <Alternatives
              projectId={project.id}
              scene={scene}
              candidates={alternatives}
              onPicked={(asset) => {
                actions.onMediaPicked(scene.id, asset);
                setChangingMedia(false);
              }}
            />
            {mediaSearch}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
