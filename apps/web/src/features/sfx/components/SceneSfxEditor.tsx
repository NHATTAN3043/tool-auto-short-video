"use client";

import type { LibrarySfx, MediaAsset, SceneSfx, SceneSfxPatch } from "@studio/domain";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { projectFileUrl } from "@/features/media/api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Slider } from "@/shared/ui/slider";

import { formatOffsetInput, parseOffsetInput } from "../format";

export interface SceneSfxActions {
  /** Copies the library effect into the project, then adds it to the scene. */
  onAdd: (librarySfxId: string) => Promise<void>;
  onChange: (sfxId: string, patch: SceneSfxPatch) => void;
  onRemove: (sfxId: string) => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
}

/** Seconds after the scene start. Keeps its own text while typing and commits on blur or Enter. */
function OffsetField({ effect, onCommit }: { effect: SceneSfx; onCommit: (offsetMs: number) => void }) {
  const [text, setText] = useState(() => formatOffsetInput(effect.offsetMs));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const parsed = parseOffsetInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    if (parsed.offsetMs !== effect.offsetMs) onCommit(parsed.offsetMs);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Phát sau</span>
        <Input
          aria-label="Phát sau bao nhiêu giây từ đầu cảnh"
          inputMode="decimal"
          className="h-8 w-20"
          value={text}
          aria-invalid={error !== null}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <span className="text-sm text-muted-foreground">giây</span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Sound effects of one scene: when each plays (from the scene start) and how loud. */
export function SceneSfxEditor({
  projectId,
  assets,
  sfx,
  library,
  actions,
}: {
  projectId: string;
  assets: readonly MediaAsset[];
  sfx: readonly SceneSfx[] | undefined;
  library: readonly LibrarySfx[];
  actions: SceneSfxActions;
}) {
  const selectId = useId();
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effects = sfx ?? [];
  const choice =
    picked !== "" && library.some((item) => item.id === picked) ? picked : (library[0]?.id ?? "");

  const add = async () => {
    if (choice === "") return;
    setBusy(true);
    setError(null);
    try {
      await actions.onAdd(choice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thêm được hiệu ứng.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <span className="text-sm font-medium">Hiệu ứng âm thanh</span>

      {effects.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {effects.map((effect) => {
            const asset = assets.find((candidate) => candidate.id === effect.assetId);
            return (
              <li
                key={effect.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 p-2"
              >
                <span className="min-w-24 truncate text-sm" title={asset?.fileName}>
                  {asset?.fileName ?? "File không còn"}
                </span>
                <OffsetField
                  key={effect.offsetMs}
                  effect={effect}
                  onCommit={(offsetMs) => {
                    actions.onChange(effect.id, { offsetMs });
                  }}
                />
                <div className="flex w-48 items-center gap-2">
                  <span className="text-sm text-muted-foreground">Âm lượng</span>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(effect.volume * 100)]}
                    thumbLabels={["Âm lượng hiệu ứng"]}
                    onValueChange={([value = 0]) => {
                      actions.onChange(effect.id, { volume: value / 100 });
                    }}
                    onValueCommit={actions.onCommit}
                  />
                </div>
                {asset ? (
                  <audio
                    controls
                    preload="none"
                    src={projectFileUrl(projectId, asset.path)}
                    className="h-8 w-48"
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  aria-label="Bỏ hiệu ứng"
                  title="Bỏ hiệu ứng"
                  onClick={() => {
                    actions.onRemove(effect.id);
                  }}
                >
                  <Trash2Icon />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {library.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Thư viện hiệu ứng đang trống. Tải hiệu ứng lên ở mục “Thư viện hiệu ứng âm thanh”.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="sr-only">
            Chọn hiệu ứng
          </label>
          <select
            id={selectId}
            className="h-8 min-w-40 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={choice}
            onChange={(event) => {
              setPicked(event.target.value);
            }}
          >
            {library.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void add()}>
            <PlusIcon />
            {busy ? "Đang thêm…" : "Thêm hiệu ứng"}
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
