// One-off uploader for when the user can't run the dashboard in a browser.
// Mirrors app/resume/actions.ts#uploadResumeAction. Reads file from argv,
// parses (.pdf or .docx), embeds via OpenRouter, writes to resume_versions.
//
// Usage inside the dashboard container:
//   node scripts/upload-resume.mjs /path/to/resume.docx [--activate]
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import mammoth from "mammoth";
import OpenAI from "openai";
import postgres from "postgres";

const [, , filePath, ...rest] = process.argv;
if (!filePath) {
  console.error("usage: node upload-resume.mjs <path.pdf|path.docx> [--activate]");
  process.exit(1);
}
const activate = rest.includes("--activate");

const EMBED_MODEL = process.env.EMBED_MODEL ?? "openai/text-embedding-3-small";
const OR_KEY = process.env.OPENROUTER_API_KEY;
const DB_URL = process.env.DATABASE_URL;
if (!OR_KEY) throw new Error("OPENROUTER_API_KEY not set");
if (!DB_URL) throw new Error("DATABASE_URL not set");

const bytes = await readFile(filePath);
const name = basename(filePath);
const lower = name.toLowerCase();

async function parsePdf(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .map((it) => (it && typeof it === "object" && "str" in it ? String(it.str) : ""))
        .join(" "),
    );
  }
  await doc.destroy?.();
  return parts.join("\n\n").replace(/\s+/g, " ").trim();
}

async function parseDocx(buf) {
  const r = await mammoth.extractRawText({ buffer: buf });
  return r.value.trim();
}

let text;
if (lower.endsWith(".pdf")) text = await parsePdf(bytes);
else if (lower.endsWith(".docx")) text = await parseDocx(bytes);
else throw new Error("only .pdf / .docx supported");
if (text.length < 50) throw new Error(`only ${text.length} chars parsed`);

const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: OR_KEY });
const embedResp = await client.embeddings.create({
  model: EMBED_MODEL,
  input: text.slice(0, 8000),
});
const embedding = embedResp.data[0].embedding;
if (embedding.length !== 1536) throw new Error(`dim ${embedding.length}`);
const vectorLiteral = "[" + embedding.map((x) => x.toFixed(7)).join(",") + "]";

const sql = postgres(DB_URL, { max: 2, prepare: false });
try {
  const [row] = await sql`
    INSERT INTO resume_versions (file_name, file_data, parsed_text, embedding, is_active)
    VALUES (${name}, ${bytes}, ${text}, ${vectorLiteral}::vector, false)
    RETURNING id
  `;
  console.log(`inserted resume #${row.id} · ${text.length.toLocaleString()} chars · ${name}`);

  if (activate) {
    await sql.begin(async (tx) => {
      await tx`UPDATE resume_versions SET is_active = false WHERE is_active = true`;
      await tx`UPDATE resume_versions SET is_active = true WHERE id = ${row.id}`;
    });
    const result = await sql`
      UPDATE job_classifications c
         SET fit_score = ROUND((100 * (
              0.5 * GREATEST(0.0, 1 - (c.embedding <=> r.embedding)) +
              0.3 * (COALESCE(c.llm_match, 0)::numeric / 10.0) +
              0.2 * COALESCE(c.proximity_bonus, 0)
            ))::numeric, 2)
        FROM (SELECT embedding FROM resume_versions WHERE is_active = true LIMIT 1) r
       WHERE c.embedding IS NOT NULL
    `;
    console.log(`activated · re-ranked ${result.count} rows`);
  }
} finally {
  await sql.end();
}
