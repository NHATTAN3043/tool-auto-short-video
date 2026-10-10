"use client";

import { useState } from "react";

import { Input } from "@/shared/ui/input";

import { formatSecondsInput, parseDurationInput } from "../format";

/**
 * Manual duration in seconds. Keeps its own text while typing ("3," is not a number yet) and commits on
 * blur or Enter. The parent remounts it (key) when the stored value changes, e.g. after undo.
 */
export function DurationField({
  id,
  durationMs,
  placeholder,
  onCommit,
}: {
  id: string;
  durationMs: number | undefined;
  placeholder: string;
  onCommit: (durationMs: number | null) => void;
}) {
  const [text, setText] = useState(() => formatSecondsInput(durationMs));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const parsed = parseDurationInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    if (parsed.durationMs !== (durationMs ?? null)) onCommit(parsed.durationMs);
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        inputMode="decimal"
        className="w-32"
        value={text}
        placeholder={placeholder}
        aria-invalid={error !== null}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
