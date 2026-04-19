"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadResumeAction } from "./actions";

export function UploadForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function onSubmit(fd: FormData) {
    setErr(null);
    setMsg(null);
    start(async () => {
      try {
        const r = await uploadResumeAction(fd);
        setMsg(`Uploaded resume #${r.id} · parsed ${r.chars.toLocaleString()} chars.`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          type="file"
          name="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          required
          className="max-w-md"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      {err && <p className="text-sm text-destructive">Error: {err}</p>}
    </form>
  );
}
