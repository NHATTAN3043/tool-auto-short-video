"use client";

import { SkillIdSchema, type ContentLanguage, type SkillId, type SkillSummary } from "@studio/domain";
import { useId } from "react";

import { Label } from "@/shared/ui/label";

import { skillHint } from "../model";

const SELECT_CLASS =
  "h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** One installed skill sent to the AI as expert notes (ADR 0012), or none. */
export function SkillPicker({
  skills,
  value,
  onChange,
  label = "Skill (tuỳ chọn)",
  language = "vi",
}: {
  skills: readonly SkillSummary[];
  value: SkillId | undefined;
  onChange: (skillId: SkillId | undefined) => void;
  label?: string;
  /** The project language, for the hint under the picker. */
  language?: ContentLanguage;
}) {
  const id = useId();
  const selected = skills.find((skill) => skill.id === value);
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={selected?.id ?? ""}
        title={selected?.description}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "" ? undefined : SkillIdSchema.parse(next));
        }}
      >
        <option value="">Không dùng skill</option>
        {skills.map((skill) => (
          <option key={skill.id} value={skill.id} title={skill.description}>
            {skill.name}
            {skill.language === "vi" ? " (tiếng Việt)" : ""}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">{skillHint(selected, language)}</span>
      {selected && selected.description !== "" ? (
        <span className="line-clamp-2 text-xs text-muted-foreground">{selected.description}</span>
      ) : null}
    </div>
  );
}
