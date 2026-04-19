"use client";

import { diffLines } from "diff";
import { useState } from "react";

export function DiffToggle({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const [open, setOpen] = useState(false);
  if (oldText === newText) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide diff" : "Show diff vs current draft"}
      </button>
      {open && <UnifiedDiff oldText={oldText} newText={newText} />}
    </div>
  );
}

export function UnifiedDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = diffLines(oldText, newText);
  // Stats
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);

  return (
    <div className="mt-1 rounded-md border overflow-hidden">
      <div className="px-2 py-1 text-xs text-muted-foreground bg-muted/40 border-b flex items-center gap-3 font-mono">
        <span className="text-green-700 dark:text-green-400">+{added}</span>
        <span className="text-red-700 dark:text-red-400">−{removed}</span>
      </div>
      <pre className="text-[11px] font-mono overflow-x-auto max-h-96 leading-relaxed">
        {parts.map((p, i) => {
          const lines = p.value.split("\n");
          // Drop trailing empty line that split introduces.
          if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
          return lines.map((line, j) => (
            <div
              key={`${i}-${j}`}
              className={
                p.added
                  ? "bg-green-500/15 text-green-900 dark:text-green-200"
                  : p.removed
                  ? "bg-red-500/15 text-red-900 dark:text-red-200 line-through decoration-red-500/50"
                  : "opacity-50"
              }
            >
              <span className="inline-block w-4 pl-1 select-none">
                {p.added ? "+" : p.removed ? "−" : " "}
              </span>
              {line}
            </div>
          ));
        })}
      </pre>
    </div>
  );
}
