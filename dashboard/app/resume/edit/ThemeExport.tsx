"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const THEMES = [
  { slug: "even", label: "Even", blurb: "Modern, balanced, conservative — safe for any industry." },
  { slug: "kendall", label: "Kendall", blurb: "Sans-serif with subtle colored accents." },
  { slug: "macchiato", label: "Macchiato", blurb: "Compact single-column layout." },
  { slug: "stackoverflow", label: "Stack Overflow", blurb: "Dense, fact-forward." },
  { slug: "onepage-plus", label: "OnePage+", blurb: "Single-page optimized." },
  { slug: "flat", label: "Flat", blurb: "Minimal, heavy whitespace." },
];

export function ThemeExport({ activeResumeId }: { activeResumeId: number }) {
  const [theme, setTheme] = useState("even");
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const previewUrl = `/api/resume/render?theme=${theme}&resumeId=${activeResumeId}&format=html`;

  async function downloadPdf() {
    setErr(null);
    setPdfBusy(true);
    try {
      const res = await fetch(
        `/api/resume/render?theme=${theme}&resumeId=${activeResumeId}&format=pdf`,
      );
      if (!res.ok) throw new Error(`PDF render failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume-${theme}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Theme</label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 h-8 text-sm"
        >
          {THEMES.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Preview
        </Button>
        <Button size="sm" variant="outline" onClick={downloadPdf} disabled={pdfBusy}>
          {pdfBusy ? "Rendering…" : "Download themed PDF"}
        </Button>
        {err && <span className="text-xs text-destructive">PDF: {err}</span>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl w-[90vw] h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Preview — <span className="font-mono text-sm">{theme}</span>
            </DialogTitle>
          </DialogHeader>
          <iframe
            key={`${theme}:${open}`}
            src={open ? previewUrl : "about:blank"}
            className="flex-1 w-full bg-white rounded-md border"
            title={`resume preview (${theme})`}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
