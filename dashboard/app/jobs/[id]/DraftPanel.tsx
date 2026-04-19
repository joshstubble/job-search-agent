"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateDraftAction, saveDraftAction } from "./actions";

export function DraftPanel({
  jobId,
  initialDraft,
}: {
  jobId: number;
  initialDraft: string | null;
}) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function onGenerate() {
    setError(null);
    startGenerating(async () => {
      try {
        const text = await generateDraftAction(jobId);
        setDraft(text);
        setSavedAt(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function onSave() {
    setError(null);
    startSaving(async () => {
      try {
        await saveDraftAction(jobId, draft);
        setSavedAt(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const busy = generating || saving;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button onClick={onGenerate} disabled={busy}>
          {generating
            ? "Drafting…"
            : draft
            ? "Regenerate"
            : "Draft cover letter"}
        </Button>
        {draft && (
          <Button variant="secondary" onClick={onSave} disabled={busy}>
            {saving ? "Saving…" : "Save edits"}
          </Button>
        )}
        {savedAt && !busy && (
          <span className="text-xs text-muted-foreground">
            saved {savedAt.toLocaleTimeString()}
          </span>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive">Error: {error}</p>
      )}
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={14}
        placeholder={
          generating
            ? "Generating…"
            : "Click 'Draft cover letter' to generate, then edit here."
        }
        className="font-serif text-[15px] leading-relaxed"
      />
    </div>
  );
}
