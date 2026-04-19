// Map our ResumeSections → the JSON Resume schema (https://jsonresume.org/schema).
// Only the fields our section data actually populates are produced; themes tolerate
// missing optional fields.
import type { ResumeSections } from "@/lib/resume-sections";

export type JsonResume = {
  basics: {
    name: string;
    label?: string;
    email?: string;
    phone?: string;
    url?: string;
    summary?: string;
    location?: {
      city?: string;
      region?: string;
      countryCode?: string;
    };
    profiles?: Array<{ network: string; username?: string; url?: string }>;
  };
  work: Array<{
    name: string;
    position: string;
    startDate?: string;
    endDate?: string;
    summary?: string;
    highlights?: string[];
  }>;
  education: Array<{
    institution: string;
    area?: string;
    studyType?: string;
    startDate?: string;
    endDate?: string;
    score?: string;
    courses?: string[];
  }>;
  skills: Array<{ name: string; keywords?: string[] }>;
  awards?: Array<{ title: string; date?: string; awarder?: string; summary?: string }>;
  publications?: Array<{ name: string; publisher?: string; releaseDate?: string; summary?: string }>;
  certificates?: Array<{ name: string; date?: string; issuer?: string }>;
  volunteer?: Array<{ organization: string; position?: string; summary?: string }>;
  interests?: Array<{ name: string }>;
  references?: Array<{ name: string; reference?: string }>;
  meta?: { theme?: string };
};

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
// Structured US phone match — captures the full number without hoovering up
// adjacent digits (e.g. ZIP codes): optional +1, optional (area), 3-3-4 digits
// with -, ., or space as separators.
const PHONE_RE =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const URL_RE = /\bhttps?:\/\/\S+/i;
// "City, ST" or "City, State Name". Require the city to look like a real
// word (uppercase-then-lowercase start) to avoid catching "DrPark"-style
// mashed-together tokens from .docx extraction.
const CITY_STATE_RE = /([A-Z][a-z][A-Za-z .'-]*?),\s*([A-Z]{2}|[A-Z][a-z]+)\b/;

// .docx text extraction sometimes collapses whitespace between fields — we've
// seen "MainSt ApartmentCity", "12345(321)", "9099name@…". Reinsert spaces at
// telltale transitions so the extractors below have a clean input.
function normalizeContactBlock(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2") // "DrCity" → "Dr City"
    .replace(/(\d)(\()/g, "$1 $2") // 32807(321 → 32807 (321
    .replace(/(\d)([A-Za-z][\w.+-]*@)/g, "$1 $2"); // 9099josh@ → 9099 josh@
}

export function parseContact(contactBlock: string): JsonResume["basics"] {
  const normalized = normalizeContactBlock(contactBlock);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const flat = lines.join(" ");

  const email = flat.match(EMAIL_RE)?.[0];
  const phone = flat.match(PHONE_RE)?.[0];
  const url = flat.match(URL_RE)?.[0];

  // For city/state matching, strip out the already-found tokens so an adjacent
  // ZIP, phone, or email can't collide with the city regex.
  let stripped = flat;
  if (email) stripped = stripped.replace(email, " ");
  if (phone) stripped = stripped.replace(phone, " ");
  if (url) stripped = stripped.replace(url, " ");
  stripped = stripped.replace(/\s+/g, " ").trim();
  const locMatch = stripped.match(CITY_STATE_RE);

  // Name is the first non-contact, non-location-looking line.
  const name =
    lines.find(
      (l) =>
        !EMAIL_RE.test(l) &&
        !PHONE_RE.test(l) &&
        !URL_RE.test(l) &&
        !CITY_STATE_RE.test(l),
    ) ??
    lines[0] ??
    "";

  return {
    name,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(url ? { url } : {}),
    ...(locMatch
      ? {
          location: {
            city: locMatch[1].trim(),
            region: locMatch[2],
            countryCode: "US",
          },
        }
      : {}),
  };
}

// Split a "May 2024 - Aug 2024" / "2024 – Present" / "05/2024-Present" style string.
export function splitDateRange(s: string | undefined): {
  startDate?: string;
  endDate?: string;
} {
  if (!s) return {};
  const normalized = s
    .replace(/\s*[–—-]\s*/g, "|")
    .replace(/\s+to\s+/i, "|")
    .trim();
  const [a, b] = normalized.split("|", 2).map((x) => x?.trim());
  const endRaw = b ?? "";
  const endDate =
    /present|current|now/i.test(endRaw) || endRaw === "" ? undefined : endRaw;
  return { startDate: a, endDate };
}

function nonEmpty<T>(xs: T[] | undefined): T[] {
  return (xs ?? []).filter((x) => x != null);
}

// Other-section heading → JSON Resume key classifier.
const OTHER_KIND = (heading: string): "awards" | "publications" | "certificates" | "volunteer" | "interests" | "unknown" => {
  const h = heading.toLowerCase();
  if (/\b(award|honor|scholarship|dean.?s)\b/.test(h)) return "awards";
  if (/\b(publication|writing|article|journal)\b/.test(h)) return "publications";
  if (/\b(certificat|admission|licensure|bar admission)\b/.test(h)) return "certificates";
  if (/\b(volunteer|pro bono|community)\b/.test(h)) return "volunteer";
  if (/\b(interest|hobb|activit)\b/.test(h)) return "interests";
  return "unknown";
};

export function sectionsToJsonResume(
  s: ResumeSections,
  theme?: string,
): JsonResume {
  const basics = parseContact(s.contact);
  if (s.summary) basics.summary = s.summary;

  const work = s.experience.map((e) => {
    const { startDate, endDate } = splitDateRange(e.dates);
    return {
      name: e.company,
      position: e.title,
      startDate,
      endDate,
      highlights: nonEmpty(e.bullets),
    };
  });

  const education = s.education.map((e) => {
    const { startDate, endDate } = splitDateRange(e.dates);
    return {
      institution: e.school,
      studyType: e.degree,
      area: e.details || undefined,
      startDate,
      endDate,
    };
  });

  const skills = s.skills.map((name) => ({ name }));

  const out: JsonResume = {
    basics,
    work,
    education,
    skills,
  };

  for (const o of s.other) {
    const kind = OTHER_KIND(o.heading);
    const body = o.content.trim();
    if (!body) continue;
    if (kind === "awards") {
      out.awards ||= [];
      out.awards.push({ title: o.heading, summary: body });
    } else if (kind === "publications") {
      out.publications ||= [];
      out.publications.push({ name: o.heading, summary: body });
    } else if (kind === "certificates") {
      out.certificates ||= [];
      out.certificates.push({ name: o.heading });
    } else if (kind === "volunteer") {
      out.volunteer ||= [];
      out.volunteer.push({ organization: o.heading, summary: body });
    } else if (kind === "interests") {
      out.interests ||= [];
      out.interests.push({ name: body });
    } else {
      // Fallback to awards for unknown sections so the theme still surfaces them.
      out.awards ||= [];
      out.awards.push({ title: o.heading, summary: body });
    }
  }

  if (theme) out.meta = { theme };
  return out;
}

// ---------------------------------------------------------------------------
// Theme loader — dynamic import keyed by theme slug. Keep this in sync with the
// packages installed in package.json.
// ---------------------------------------------------------------------------
export const AVAILABLE_THEMES = [
  { slug: "even", label: "Even", blurb: "Modern, balanced, conservative — safe for any industry." },
  { slug: "kendall", label: "Kendall", blurb: "Sans-serif with subtle colored accents." },
  { slug: "macchiato", label: "Macchiato", blurb: "Compact single-column layout." },
  { slug: "stackoverflow", label: "Stack Overflow", blurb: "Dense, fact-forward." },
  { slug: "onepage-plus", label: "OnePage+", blurb: "Single-page optimized." },
  { slug: "flat", label: "Flat", blurb: "Minimal, heavy whitespace." },
] as const;

export type ThemeSlug = (typeof AVAILABLE_THEMES)[number]["slug"];

type Theme = { render: (r: unknown) => string };

export async function loadTheme(slug: ThemeSlug): Promise<Theme> {
  switch (slug) {
    case "even":
      return (await import("jsonresume-theme-even")) as unknown as Theme;
    case "kendall":
      return (await import("jsonresume-theme-kendall")) as unknown as Theme;
    case "macchiato":
      return (await import("jsonresume-theme-macchiato")) as unknown as Theme;
    case "stackoverflow":
      return (await import("jsonresume-theme-stackoverflow")) as unknown as Theme;
    case "onepage-plus":
      return (await import("jsonresume-theme-onepage-plus")) as unknown as Theme;
    case "flat":
      return (await import("jsonresume-theme-flat")) as unknown as Theme;
  }
}

export async function renderThemeHtml(
  resume: JsonResume,
  slug: ThemeSlug,
): Promise<string> {
  const theme = await loadTheme(slug);
  if (typeof theme.render !== "function")
    throw new Error(`Theme ${slug} does not export render()`);
  return theme.render(resume);
}
