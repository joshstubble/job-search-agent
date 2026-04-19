"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ResumeSections } from "@/lib/resume-sections";

import {
  extractSectionsAction,
  renderSectionsToTextAction,
} from "./sections-actions";

export function SectionsPanel({
  resumeId,
  initialSections,
  onApplyToDraft,
}: {
  resumeId: number;
  initialSections: ResumeSections | null;
  onApplyToDraft: (text: string) => void;
}) {
  const [sections, setSections] = useState<ResumeSections | null>(initialSections);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function extract() {
    setErr(null);
    start(async () => {
      try {
        const s = await extractSectionsAction(resumeId);
        setSections(s);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function applyToDraft() {
    if (!sections) return;
    const text = await renderSectionsToTextAction(sections);
    onApplyToDraft(text);
  }

  if (!sections) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Parse the active resume into structured sections (summary, experience,
          education, skills, other). The LLM uses Gemini 3.1 Pro with JSON-mode
          output; cost is ~$0.02 per parse.
        </p>
        <Button size="sm" onClick={extract} disabled={pending}>
          {pending ? "Parsing…" : "Extract sections"}
        </Button>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {sections.experience.length} job{sections.experience.length === 1 ? "" : "s"} ·{" "}
          {sections.education.length} edu ·{" "}
          {sections.skills.length} skill{sections.skills.length === 1 ? "" : "s"} ·{" "}
          {sections.other.length} other
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={extract} disabled={pending}>
            {pending ? "Re-parsing…" : "Re-parse"}
          </Button>
          <Button size="sm" variant="secondary" onClick={applyToDraft} disabled={pending}>
            Render back to draft ↑
          </Button>
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}

      <SectionBox title="Contact">
        <Textarea
          value={sections.contact}
          rows={3}
          onChange={(e) =>
            setSections({ ...sections, contact: e.target.value })
          }
        />
      </SectionBox>

      <SectionBox title="Summary">
        <Textarea
          value={sections.summary}
          rows={3}
          onChange={(e) =>
            setSections({ ...sections, summary: e.target.value })
          }
        />
      </SectionBox>

      <SectionBox title="Experience">
        <div className="space-y-3">
          {sections.experience.map((e, i) => (
            <div key={i} className="border rounded-md p-2 space-y-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                <Input
                  value={e.title}
                  placeholder="Title"
                  onChange={(ev) =>
                    updateExperience(i, { ...e, title: ev.target.value })
                  }
                />
                <Input
                  value={e.company}
                  placeholder="Company"
                  onChange={(ev) =>
                    updateExperience(i, { ...e, company: ev.target.value })
                  }
                />
                <Input
                  value={e.dates}
                  placeholder="Dates"
                  onChange={(ev) =>
                    updateExperience(i, { ...e, dates: ev.target.value })
                  }
                />
              </div>
              <Textarea
                value={e.bullets.join("\n")}
                rows={Math.max(2, e.bullets.length)}
                placeholder="One bullet per line"
                onChange={(ev) =>
                  updateExperience(i, {
                    ...e,
                    bullets: ev.target.value.split("\n").filter((l) => l.trim()),
                  })
                }
              />
            </div>
          ))}
        </div>
      </SectionBox>

      <SectionBox title="Education">
        <div className="space-y-2">
          {sections.education.map((e, i) => (
            <div key={i} className="grid grid-cols-2 gap-1.5">
              <Input
                value={e.degree}
                placeholder="Degree"
                onChange={(ev) =>
                  updateEducation(i, { ...e, degree: ev.target.value })
                }
              />
              <Input
                value={e.school}
                placeholder="School"
                onChange={(ev) =>
                  updateEducation(i, { ...e, school: ev.target.value })
                }
              />
              <Input
                value={e.dates}
                placeholder="Dates"
                onChange={(ev) =>
                  updateEducation(i, { ...e, dates: ev.target.value })
                }
              />
              <Input
                value={e.details}
                placeholder="Details"
                onChange={(ev) =>
                  updateEducation(i, { ...e, details: ev.target.value })
                }
              />
            </div>
          ))}
        </div>
      </SectionBox>

      <SectionBox title="Skills">
        <Textarea
          value={sections.skills.join(", ")}
          rows={2}
          onChange={(e) =>
            setSections({
              ...sections,
              skills: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </SectionBox>

      {sections.other.length > 0 && (
        <SectionBox title="Other">
          <div className="space-y-2">
            {sections.other.map((o, i) => (
              <div key={i} className="space-y-1">
                <Input
                  value={o.heading}
                  placeholder="Heading"
                  onChange={(ev) => updateOther(i, { ...o, heading: ev.target.value })}
                />
                <Textarea
                  value={o.content}
                  rows={2}
                  onChange={(ev) => updateOther(i, { ...o, content: ev.target.value })}
                />
              </div>
            ))}
          </div>
        </SectionBox>
      )}
    </div>
  );

  function updateExperience(i: number, e: ResumeSections["experience"][number]) {
    if (!sections) return;
    const next = sections.experience.slice();
    next[i] = e;
    setSections({ ...sections, experience: next });
  }
  function updateEducation(i: number, e: ResumeSections["education"][number]) {
    if (!sections) return;
    const next = sections.education.slice();
    next[i] = e;
    setSections({ ...sections, education: next });
  }
  function updateOther(i: number, o: ResumeSections["other"][number]) {
    if (!sections) return;
    const next = sections.other.slice();
    next[i] = o;
    setSections({ ...sections, other: next });
  }
}

function SectionBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </h4>
      {children}
    </div>
  );
}
