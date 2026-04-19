// Render an HTML string to PDF bytes using the system Chromium installed in the
// dashboard Dockerfile. Keeps a singleton browser across calls to avoid the
// ~500ms launch cost per request.
import puppeteer, { type Browser } from "puppeteer-core";

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--headless=new",
  "--hide-scrollbars",
  "--mute-audio",
];

declare global {
  // eslint-disable-next-line no-var
  var __lawBrowser: Browser | undefined;
}

async function getBrowser(): Promise<Browser> {
  if (globalThis.__lawBrowser && globalThis.__lawBrowser.connected)
    return globalThis.__lawBrowser;
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";
  const b = await puppeteer.launch({
    executablePath: exe,
    args: CHROMIUM_ARGS,
    headless: true,
  });
  globalThis.__lawBrowser = b;
  return b;
}

export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    // US Letter by default; tweak to "A4" here if you need the non-US size.
    const buf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
    });
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}
