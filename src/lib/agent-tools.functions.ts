/**
 * Server functions exposing agent tools to the client (Files page, Browser
 * page, planner's optional fall-through calls). The chat route inlines its
 * own server-side tool execution for streaming; these are for direct UI use.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { fetchUrl } from "@/lib/browser-fetch.server";
import { runJs } from "@/lib/code-runner.server";

export const fetchUrlFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ url: z.string().url() }).parse(d))
  .handler(async ({ data }) => fetchUrl(data.url));

export const runJsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: z.string().min(1).max(20_000) }).parse(d),
  )
  .handler(async ({ data }) => runJs(data.code));
