"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { tailorResumeForJobAction } from "./actions";

export function TailorPanel({ jobId }: { jobId: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ resumeId: number; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function tailor() {
    setErr(null);
    start(async () => {
      try {
        const r = await tailorResumeForJobAction(jobId);
        setResult({ resumeId: r.resumeId, text: r.tailoredText });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button onClick={tailor} disabled={pending}>
          {pending ? "Tailoring…" : "Tailor resume for this role"}
        </Button>
        {result && (
          <a
            href="/resume"
            className="text-xs underline underline-offset-2 text-muted-foreground"
          >
            Open /resume to activate #{result.resumeId} ↗
          </a>
        )}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {result && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Saved as resume version #{result.resumeId} (inactive). Preview:
          </p>
          <Textarea
            value={result.text}
            readOnly
            rows={14}
            className="font-mono text-[12px] leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}
