"use client";

import { CONTENT_LANGUAGE_LABELS, ContentLanguageSchema, type ContentLanguage } from "@studio/domain";
import { useId } from "react";

import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";

const SELECT_CLASS =
  "h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The project language (ADR 0013): what the AI writes the narration in and what the voice is told to
 * read. One value per project, so every place that shows it edits the same choice.
 */
export function LanguageSelect({
  value,
  onChange,
  label = "Ngôn ngữ",
  className,
}: {
  value: ContentLanguage;
  onChange: (language: ContentLanguage) => void;
  label?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => {
          onChange(ContentLanguageSchema.parse(event.target.value));
        }}
      >
        {ContentLanguageSchema.options.map((language) => (
          <option key={language} value={language}>
            {CONTENT_LANGUAGE_LABELS[language]}
          </option>
        ))}
      </select>
    </div>
  );
}
