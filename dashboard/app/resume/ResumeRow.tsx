"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { activateResumeAction, deleteResumeAction } from "./actions";

export function ResumeRow({
  id,
  isActive,
  hasEmbedding,
}: {
  id: number;
  isActive: boolean;
  hasEmbedding: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function activate() {
    setErr(null);
    setMsg(null);
    start(async () => {
      try {
        const r = await activateResumeAction(id);
        setMsg(`Re-ranked ${r.rescored} jobs against this resume.`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function del() {
    if (!confirm("Delete this resume version?")) return;
    start(async () => {
      try {
        await deleteResumeAction(id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={isActive ? "default" : "outline"}
          onClick={activate}
          disabled={pending || !hasEmbedding}
        >
          {isActive ? "Active · re-rank" : "Activate + re-rank"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={del}
          disabled={pending || isActive}
        >
          Delete
        </Button>
      </div>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
