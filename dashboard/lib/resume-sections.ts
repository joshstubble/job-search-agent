// Structured resume schema + LLM-driven parse helper.
import { openRouter, RESUME_EDITOR_MODEL } from "@/lib/llm";

export type ExperienceEntry = {
  company: string;
  title: string;
  dates: string;
  bullets: string[];
};

export type EducationEntry = {
  school: string;
  degree: string;
  dates: string;
  details: string;
};

export type OtherSection = {
  heading: string;
  content: string;
};

export type ResumeSections = {
  contact: string;
  summary: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
  other: OtherSection[];
};

const PARSE_PROMPT = `You are a strict JSON extractor. Parse the resume text below into this schema:

{
  "contact": "full contact block as a single string (name, email, phone, location, links — preserve line breaks)",
  "summary": "the professional summary / objective paragraph, if any (else empty string)",
  "experience": [
    {"company": "", "title": "", "dates": "", "bullets": ["..."]}
  ],
  "education": [
    {"school": "", "degree": "", "dates": "", "details": ""}
  ],
  "skills": ["...skill or technology..."],
  "other": [
    {"heading": "section heading verbatim", "content": "section body"}
  ]
}

Rules:
- Output ONLY valid JSON. No prose, no code fences.
- Do not invent content. If a section is absent in the source, return an empty string / empty array for that key.
- Preserve the wording from the source; your job is to classify blocks, not rewrite them.
- Dates: preserve the original format (e.g. "May 2024 – Present").
- Bullets: split multi-line bullet lists into array entries; drop leading bullet characters.
- "other" catches anything that isn't clearly contact/summary/experience/education/skills (Awards, Bar Admissions, Publications, Clinics, etc.).`;

export async function parseResumeSections(text: string): Promise<ResumeSections> {
  const res = await openRouter().chat.completions.create({
    model: RESUME_EDITOR_MODEL,
    max_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PARSE_PROMPT },
      { role: "user", content: text },
    ],
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("Parser returned empty content");
  const parsed = JSON.parse(raw);
  return normalizeSections(parsed);
}

function normalizeSections(p: Record<string, unknown>): ResumeSections {
  const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const asString = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    contact: asString(p.contact),
    summary: asString(p.summary),
    experience: asArray<ExperienceEntry>(p.experience).map((e) => ({
      company: asString(e?.company),
      title: asString(e?.title),
      dates: asString(e?.dates),
      bullets: asArray<string>(e?.bullets)
        .map(asString)
        .filter(Boolean),
    })),
    education: asArray<EducationEntry>(p.education).map((e) => ({
      school: asString(e?.school),
      degree: asString(e?.degree),
      dates: asString(e?.dates),
      details: asString(e?.details),
    })),
    skills: asArray<string>(p.skills).map(asString).filter(Boolean),
    other: asArray<OtherSection>(p.other).map((e) => ({
      heading: asString(e?.heading),
      content: asString(e?.content),
    })),
  };
}

// Render sections back to plain text — used when saving a sections-edited version.
export function renderSectionsToText(s: ResumeSections): string {
  const parts: string[] = [];
  if (s.contact.trim()) parts.push(s.contact.trim());
  if (s.summary.trim()) {
    parts.push("SUMMARY\n" + s.summary.trim());
  }
  if (s.experience.length) {
    const block = [
      "EXPERIENCE",
      ...s.experience.map((e) => {
        const head = [e.title, e.company, e.dates].filter(Boolean).join(" | ");
        const bullets = e.bullets.map((b) => `• ${b}`).join("\n");
        return [head, bullets].filter(Boolean).join("\n");
      }),
    ];
    parts.push(block.join("\n\n"));
  }
  if (s.education.length) {
    const block = [
      "EDUCATION",
      ...s.education.map((e) =>
        [e.degree, e.school, e.dates, e.details].filter(Boolean).join(" | "),
      ),
    ];
    parts.push(block.join("\n"));
  }
  if (s.skills.length) parts.push("SKILLS\n" + s.skills.join(", "));
  for (const o of s.other) {
    if (!o.heading && !o.content) continue;
    parts.push(`${o.heading.toUpperCase()}\n${o.content}`.trim());
  }
  return parts.join("\n\n");
}
