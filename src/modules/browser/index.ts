/**
 * Browser module — Milestone 4 (browser-lite).
 *
 * Today this is a server-side HTTP fetch + HTML reader, exposed to the chat
 * planner as the `fetch_url` tool. It's enough for real work: research,
 * link/health checks, scraping a public page, reading API JSON. A full
 * headless-Chromium controller (click, fill, screenshot) lands when we have
 * a runtime that can host it.
 */
import { useServerFn } from "@tanstack/react-start";
import { fetchUrlFn } from "@/lib/agent-tools.functions";

export interface BrowserSnapshot {
  url: string;
  finalUrl: string;
  status: number;
  title: string | null;
  text: string;
  links: Array<{ href: string; text: string }>;
}

export function useBrowser() {
  const fetcher = useServerFn(fetchUrlFn);
  return {
    async open(url: string): Promise<BrowserSnapshot> {
      const r = await fetcher({ data: { url } });
      return {
        url: r.url,
        finalUrl: r.finalUrl,
        status: r.status,
        title: r.title,
        text: r.text,
        links: r.links,
      };
    },
  };
}
