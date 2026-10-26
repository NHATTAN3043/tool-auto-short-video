import { foldText, type LibraryMedia } from "@studio/domain";

export type LibraryKindFilter = "all" | "video" | "image";

/** Manual browsing never requires tags, narration, or clip analysis. */
export function filterLibraryMedia(
  items: readonly LibraryMedia[],
  query: string,
  kind: LibraryKindFilter,
): LibraryMedia[] {
  const needle = foldText(query.trim());
  return items.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (needle === "" || foldText([item.fileName, ...item.tags].join(" ")).includes(needle)),
  );
}
