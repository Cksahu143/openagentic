/**
 * Server-side browser-lite: fetch a URL, parse title + readable text.
 * Real headless browser lands later; this gets us actually useful web reads
 * (research, scraping, link checks, simple website testing) today.
 */

const MAX_BYTES = 1_500_000; // 1.5 MB
const TIMEOUT_MS = 15_000;
const UA =
  "OpenAgentBot/0.1 (+https://lovable.dev) Mozilla/5.0 (compatible)";

export interface FetchUrlResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  title: string | null;
  text: string;
  links: Array<{ href: string; text: string }>;
  bytes: number;
  truncated: boolean;
  elapsedMs: number;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 240) : null;
}

function extractLinks(html: string, base: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 40) {
    try {
      const href = new URL(m[1], base).toString();
      const text = stripTags(m[2]).slice(0, 120);
      if (text) out.push({ href, text });
    } catch {
      // ignore bad URLs
    }
  }
  return out;
}

export async function fetchUrl(rawUrl: string): Promise<FetchUrlResult> {
  const started = Date.now();
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Only http(s) URLs are allowed");
  }
  // Block private network ranges to reduce SSRF risk.
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Refusing to fetch a private/loopback address");
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: ctrl.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(t);
  }

  const contentType = resp.headers.get("content-type");
  const buf = await resp.arrayBuffer();
  const bytes = buf.byteLength;
  const truncated = bytes > MAX_BYTES;
  const slice = truncated ? buf.slice(0, MAX_BYTES) : buf;
  const body = new TextDecoder("utf-8", { fatal: false }).decode(slice);

  const isHtml = (contentType ?? "").includes("html") || /<html[\s>]/i.test(body);
  const title = isHtml ? extractTitle(body) : null;
  const text = isHtml ? stripTags(body) : body;
  const links = isHtml ? extractLinks(body, resp.url) : [];

  return {
    url: url.toString(),
    finalUrl: resp.url,
    status: resp.status,
    ok: resp.ok,
    contentType,
    title,
    text: text.slice(0, 12_000),
    links,
    bytes,
    truncated,
    elapsedMs: Date.now() - started,
  };
}
