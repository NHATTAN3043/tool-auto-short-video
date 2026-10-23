"use client";

import {
  AI_RANK_MAX_CANDIDATES,
  candidateKey,
  isOwnCandidate,
  orderByRanking,
  SearchLanguageSchema,
  toRankCandidate,
  type ContentLanguage,
  type MediaCandidate,
  type MediaRankingMode,
  type SearchLanguage,
  type VisualPlan,
  type VisualPlansSuggestion,
} from "@studio/domain";
import { CheckIcon, PlayIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { AiConfirmDialog, useAiTask } from "@/features/ai";
import { RankingModePicker } from "@/features/full-ai/components/RankingModePicker";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import type { PickedMedia } from "../api";
import { useMediaSearch, type MediaSearchState, type SourceChoice } from "../hooks/use-media-search";
import {
  formatDuration,
  keywordGroups,
  LANGUAGE_LABELS,
  linkUrl,
  narrationKeywordGroup,
  previewUrl,
  segmentLabel,
  orientationLabel,
  SOURCE_LABELS,
} from "../model";
import { KeywordChips } from "./KeywordChips";

const SELECT_CLASS = "h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs";

function CandidateCard({
  candidate,
  picking,
  disabled,
  onPreview,
  onPick,
}: {
  candidate: MediaCandidate;
  picking: boolean;
  disabled: boolean;
  onPreview: () => void;
  onPick: () => void;
}) {
  return (
    <li className="flex flex-col overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        className="group relative aspect-[9/16] bg-muted"
        onClick={onPreview}
        title="Xem thử"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied stock thumbnails, not optimizable */}
        <img src={linkUrl(candidate.thumbnail)} alt="" loading="lazy" className="size-full object-cover" />
        <span className="absolute inset-0 hidden items-center justify-center bg-black/30 group-hover:flex">
          <PlayIcon className="size-8 text-white" />
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-1 p-1.5">
        <Badge variant={isOwnCandidate(candidate) ? "default" : "outline"}>
          {SOURCE_LABELS[candidate.provider]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {orientationLabel(candidate.width, candidate.height)}
          {candidate.durationMs !== undefined ? ` · ${formatDuration(candidate.durationMs)}` : ""}
        </span>
        {segmentLabel(candidate) ? (
          <span className="w-full text-xs text-muted-foreground">{segmentLabel(candidate)}</span>
        ) : null}
        {candidate.textOverlay === true ? (
          <Badge variant="outline" title="Hình có chữ, phụ đề hoặc logo in sẵn">
            Có chữ/logo
          </Badge>
        ) : null}
      </div>
      <Button size="xs" className="m-1.5 mt-0" disabled={disabled} onClick={onPick}>
        {picking ? "Đang tải về…" : "Chọn cho cảnh"}
      </Button>
    </li>
  );
}

/** AI ranking of the search results, offered when the scene's project allows it (mediaRanking). */
export interface MediaRankingOptions {
  sceneId: string;
  narration: string;
  intent?: string;
  mode: MediaRankingMode;
  onModeChange: (mode: MediaRankingMode) => void;
}

/** Ranks the first results of the current search; the order applies only to that same search. */
function useAiRanking(projectId: string, search: MediaSearchState, options: MediaRankingOptions | null) {
  const controller = useAiTask(projectId);
  const [rankedResult, setRankedResult] = useState<MediaSearchState["result"]>(null);
  const keys =
    controller.state.step === "review" &&
    controller.state.result.type === "rank_media" &&
    rankedResult === search.result
      ? (controller.state.result.suggestion.scenes[0]?.keys ?? null)
      : null;
  const candidates = search.result?.candidates ?? [];
  return {
    controller,
    ranked: keys !== null,
    candidates: keys === null ? candidates : orderByRanking(candidates, keys),
    start: () => {
      if (!options || candidates.length < 2) return;
      setRankedResult(search.result);
      void controller.prepare({
        type: "rank_media",
        input: {
          mode: options.mode,
          scenes: [
            {
              sceneId: options.sceneId,
              narration: options.narration.slice(0, 5000),
              ...(options.intent && { intent: options.intent.slice(0, 500) }),
              candidates: candidates.slice(0, AI_RANK_MAX_CANDIDATES).map(toRankCandidate),
            },
          ],
        },
      });
    },
  };
}

function AiRankingControls({
  options,
  ranking,
}: {
  options: MediaRankingOptions;
  ranking: ReturnType<typeof useAiRanking>;
}) {
  const { state } = ranking.controller;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <RankingModePicker compact value={options.mode} onChange={options.onModeChange} />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={state.step === "estimating" || state.step === "running"}
          onClick={ranking.start}
        >
          <SparklesIcon />
          Xếp hạng {AI_RANK_MAX_CANDIDATES} kết quả đầu bằng AI
        </Button>
      </div>
      {state.step === "estimating" ? (
        <p className="text-xs text-muted-foreground">Đang ước tính chi phí…</p>
      ) : null}
      {state.step === "running" ? (
        <p className="text-xs" role="status">
          AI đang xếp hạng…
        </p>
      ) : null}
      {state.step === "error" ? (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      {ranking.ranked ? (
        <p className="flex items-center gap-2 text-xs">
          Đã sắp xếp theo AI.
          <Button size="xs" variant="ghost" onClick={ranking.controller.reset}>
            Về thứ tự tìm kiếm
          </Button>
        </p>
      ) : null}
      <AiConfirmDialog controller={ranking.controller} />
    </div>
  );
}

/** AI keywords for this one scene, asked from its search panel in any mode (an on-demand visual task). */
export interface KeywordSuggestOptions {
  sceneId: string;
  /** Whole script, for context. */
  script: string;
  /** Saves the scene's new visual plan (intent, keywords in three languages). */
  onApply: (suggestion: VisualPlansSuggestion) => void;
}

function AiKeywordControls({
  projectId,
  narration,
  hasKeywords,
  options,
  onKeywords,
}: {
  projectId: string;
  narration: string;
  hasKeywords: boolean;
  options: KeywordSuggestOptions;
  /** The first new keyword, to search with right away. */
  onKeywords: (query: string, lang: SearchLanguage) => void;
}) {
  const controller = useAiTask(projectId);
  const { state, reset } = controller;
  const { onApply } = options;

  // Applied as soon as it arrives: the user already confirmed the cost, and the keywords stay editable.
  useEffect(() => {
    if (state.step !== "review" || state.result.type !== "visual") return;
    const suggestion = state.result.suggestion;
    onApply(suggestion);
    reset();
    const first = suggestion.plans[0]?.visualPlan.searchQueries[0];
    if (first) onKeywords(first, "en");
  }, [state, onApply, reset, onKeywords]);

  const busy = state.step === "estimating" || state.step === "running";
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          size="xs"
          variant="outline"
          disabled={busy || narration.trim() === ""}
          onClick={() => {
            void controller.prepare({
              type: "visual",
              input: {
                script: options.script.slice(0, 20_000),
                scenes: [{ id: options.sceneId, narration: narration.slice(0, 5000) }],
                onDemand: true,
              },
            });
          }}
        >
          <SparklesIcon />
          {state.step === "running"
            ? "AI đang gợi ý…"
            : hasKeywords
              ? "Gợi ý lại từ khoá bằng AI"
              : "Gợi ý từ khoá bằng AI"}
        </Button>
      </div>
      {state.step === "error" ? (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <AiConfirmDialog controller={controller} />
    </div>
  );
}

/**
 * Media search of one scene: keywords from the scene's visual plan in three languages, shared library
 * first, then Pexels/Pixabay. Picking a candidate adds it to the project and assigns it to this scene only.
 */
export function SceneMediaSearch({
  projectId,
  sceneLabel,
  visualPlan,
  narration,
  language,
  onPicked,
  ranking: rankingOptions = null,
  keywordSuggest = null,
}: {
  projectId: string;
  sceneLabel: string;
  visualPlan: VisualPlan | undefined;
  /** The scene's narration: free keywords when it has no AI ones, and the text the AI reads. */
  narration: string;
  /** The project language, for the free keywords. */
  language: ContentLanguage;
  onPicked: (picked: PickedMedia) => void;
  /** Null hides the AI keyword button (no AI provider). */
  keywordSuggest?: KeywordSuggestOptions | null;
  /** Null hides AI ranking (no AI provider or the mediaRanking toggle is off). */
  ranking?: MediaRankingOptions | null;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<MediaCandidate | null>(null);
  const aiGroups = keywordGroups(visualPlan);
  const fallback = aiGroups.length === 0 ? narrationKeywordGroup(narration, language) : null;
  const search = useMediaSearch(
    projectId,
    visualPlan,
    (picked) => {
      onPicked(picked);
      setPreview(null);
      setOpen(false);
    },
    fallback,
  );
  const queryId = useId();
  const runKeyword = (query: string, lang: SearchLanguage) => {
    void search.run({ query, lang });
  };
  const ranking = useAiRanking(projectId, search, rankingOptions);

  if (!open) {
    return (
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            void search.run();
          }}
        >
          <SearchIcon />
          Tìm media cho {sceneLabel.toLowerCase()}
        </Button>
      </div>
    );
  }

  const stockMissing = search.result !== null && search.result.stockProviders.length === 0;
  const pick = (candidate: MediaCandidate) => {
    void search.pick(candidate);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <SearchIcon className="size-4" />
          Tìm media cho {sceneLabel.toLowerCase()}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Đóng tìm kiếm"
          onClick={() => {
            setOpen(false);
          }}
        >
          <XIcon />
        </Button>
      </div>

      <KeywordChips
        groups={fallback ? [fallback] : aiGroups}
        onSearch={(query, lang) => {
          void search.run({ query, lang });
        }}
      />
      {fallback ? (
        <p className="text-xs text-muted-foreground">
          Từ khoá tự tách từ lời đọc, không dùng AI.
          {keywordSuggest ? " Muốn từ khoá tiếng Anh, Trung chính xác hơn thì nhờ AI gợi ý." : ""}
        </p>
      ) : null}
      {keywordSuggest ? (
        <AiKeywordControls
          projectId={projectId}
          narration={narration}
          hasKeywords={aiGroups.length > 0}
          options={keywordSuggest}
          onKeywords={runKeyword}
        />
      ) : null}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search.run();
        }}
      >
        <Input
          id={queryId}
          aria-label="Từ khoá tìm media"
          className="min-w-40 flex-1"
          value={search.query}
          placeholder="cat playing, mèo con, 小猫…"
          onChange={(event) => {
            search.setQuery(event.target.value);
          }}
        />
        <select
          aria-label="Ngôn ngữ của từ khoá"
          className={SELECT_CLASS}
          value={search.lang}
          onChange={(event) => {
            search.switchLang(SearchLanguageSchema.parse(event.target.value));
          }}
        >
          {SearchLanguageSchema.options.map((lang: SearchLanguage) => (
            <option key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </option>
          ))}
        </select>
        <select
          aria-label="Loại media"
          className={SELECT_CLASS}
          value={search.kind}
          onChange={(event) => {
            search.setKind(event.target.value === "image" ? "image" : "video");
          }}
        >
          <option value="video">Video</option>
          <option value="image">Ảnh</option>
        </select>
        <select
          aria-label="Nguồn"
          className={SELECT_CLASS}
          value={search.source}
          onChange={(event) => {
            search.setSource(event.target.value as SourceChoice);
          }}
        >
          <option value="all">Tất cả nguồn</option>
          <option value="project">{SOURCE_LABELS.project}</option>
          <option value="library">{SOURCE_LABELS.library}</option>
          <option value="pexels">{SOURCE_LABELS.pexels}</option>
          <option value="pixabay">{SOURCE_LABELS.pixabay}</option>
        </select>
        <Button type="submit" size="sm" disabled={search.searching || search.query.trim() === ""}>
          <SearchIcon />
          {search.searching ? "Đang tìm…" : "Tìm"}
        </Button>
      </form>

      {stockMissing ? (
        <p className="text-xs text-muted-foreground">
          Chỉ đang tìm trong thư viện chung. Bật “Tìm media” trong cài đặt dự án và điền PEXELS_API_KEY /
          PIXABAY_API_KEY để tìm thêm trên Pexels, Pixabay.
        </p>
      ) : null}
      {search.result?.errors.map((failure) => (
        <p key={failure.provider} className="text-xs text-destructive">
          {failure.message}
        </p>
      ))}
      {search.error ? (
        <p className="text-sm text-destructive" role="alert">
          {search.error}
        </p>
      ) : null}

      {search.result && search.result.candidates.length === 0 && !search.searching ? (
        <p className="text-sm text-muted-foreground">
          Không tìm thấy. Thử từ khoá khác, hoặc một từ khoá tiếng Anh/Trung ở trên.
        </p>
      ) : null}
      {rankingOptions && search.result && search.result.candidates.length > 1 ? (
        <AiRankingControls options={rankingOptions} ranking={ranking} />
      ) : null}
      {search.result && search.result.candidates.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {ranking.candidates.map((candidate) => {
            const key = candidateKey(candidate);
            return (
              <CandidateCard
                key={key}
                candidate={candidate}
                picking={search.picking === key}
                disabled={search.picking !== null}
                onPreview={() => {
                  setPreview(candidate);
                }}
                onPick={() => {
                  pick(candidate);
                }}
              />
            );
          })}
        </ul>
      ) : null}

      <AlertDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preview
                ? `${SOURCE_LABELS[preview.provider]} · ${orientationLabel(preview.width, preview.height)} · ${String(preview.width)}×${String(preview.height)}`
                : ""}
            </AlertDialogTitle>
          </AlertDialogHeader>
          {preview ? (
            preview.kind === "video" ? (
              <video
                key={candidateKey(preview)}
                src={previewUrl(preview)}
                poster={linkUrl(preview.thumbnail)}
                controls
                autoPlay
                muted
                loop
                playsInline
                className="max-h-[60vh] w-full rounded-md bg-black object-contain"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- proxied stock image */
              <img
                src={linkUrl(preview.preview ?? preview.thumbnail)}
                alt=""
                className="max-h-[60vh] w-full rounded-md object-contain"
              />
            )
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Đóng</AlertDialogCancel>
            <Button
              disabled={search.picking !== null}
              onClick={() => {
                if (preview) pick(preview);
              }}
            >
              <CheckIcon />
              {search.picking !== null ? "Đang tải về…" : "Chọn cho cảnh"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
