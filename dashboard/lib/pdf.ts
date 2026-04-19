// Server-side PDF text extraction using pdfjs-dist's legacy build (no worker).
export async function parsePdfText(bytes: Uint8Array): Promise<string> {
  // Dynamic import so the large pdfjs bundle only loads in the one action that needs it.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: unknown) => (it && typeof it === "object" && "str" in it ? String((it as { str: string }).str) : ""))
      .join(" ");
    pages.push(text);
  }
  await doc.destroy?.();
  return pages.join("\n\n").replace(/\s+/g, " ").trim();
}
