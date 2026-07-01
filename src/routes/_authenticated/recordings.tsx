import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Circle, Play, Square, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AgentActivity } from "@/components/agent-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";

export const Route = createFileRoute("/_authenticated/recordings")({
  head: () => ({ meta: [{ title: "Recordings · OpenAgent" }] }),
  component: Recordings,
});

function Recordings() {
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  const chunksRef = useRef<Blob[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const list = useQuery({
    queryKey: ["recordings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("screen_recordings")
        .select("id, title, storage_path, duration_ms, size_bytes, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => () => stopStream(), []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => finalize();
      recRef.current = rec;
      startedRef.current = Date.now();
      rec.start(1000);
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(
        () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)),
        500,
      );
      stream.getVideoTracks()[0].addEventListener("ended", stop);
      void logActivity({ module: "recordings", message: "Screen recording started" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cannot record");
    }
  }

  function stop() {
    recRef.current?.state === "recording" && recRef.current.stop();
    stopStream();
    setRecording(false);
  }

  const upload = useMutation({
    mutationFn: async ({ blob, ms }: { blob: Blob; ms: number }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const id = crypto.randomUUID();
      const path = `${u.user.id}/recordings/${id}.webm`;
      const { error: upErr } = await supabase.storage
        .from("user-files")
        .upload(path, blob, { contentType: "video/webm", upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("screen_recordings").insert({
        id,
        user_id: u.user.id,
        title: title.trim() || `Recording ${new Date().toLocaleString()}`,
        storage_path: path,
        duration_ms: ms,
        size_bytes: blob.size,
        mime_type: "video/webm",
      });
      if (error) throw error;
      void logActivity({
        module: "recordings",
        message: `Recording saved (${Math.round(blob.size / 1024)} KB, ${Math.round(ms / 1000)}s)`,
      });
    },
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["recordings"] });
      toast.success("Recording saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  async function finalize() {
    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    const ms = Date.now() - startedRef.current;
    if (blob.size === 0) return;
    upload.mutate({ blob, ms });
  }

  async function play(id: string, path: string) {
    if (playing === id) {
      setPlaying(null);
      setPlayingUrl(null);
      return;
    }
    const { data, error } = await supabase.storage
      .from("user-files")
      .createSignedUrl(path, 3600);
    if (error) return toast.error(error.message);
    setPlaying(id);
    setPlayingUrl(data.signedUrl);
  }

  const del = useMutation({
    mutationFn: async (r: { id: string; storage_path: string }) => {
      await supabase.storage.from("user-files").remove([r.storage_path]);
      const { error } = await supabase.from("screen_recordings").delete().eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recordings"] }),
  });

  return (
    <AppShell
      title="Recordings"
      subtitle="Screen-record what the agent does so you can play it back"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 md:grid-cols-[1fr_320px] md:p-6">
        <div className="space-y-4">
          <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Video className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <h2 className="text-sm font-semibold">Record your screen or a browser tab</h2>
                <p className="text-xs text-muted-foreground">
                  Uses your browser's screen-share picker. Video is saved privately to your
                  storage. Give it a title before you start.
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Recording title (e.g. Agent researching HN)"
                className="max-w-sm"
                disabled={recording}
              />
              {!recording ? (
                <Button onClick={start} disabled={upload.isPending}>
                  <Circle className="mr-1 h-4 w-4 fill-current text-destructive" /> Start recording
                </Button>
              ) : (
                <Button onClick={stop} variant="destructive">
                  <Square className="mr-1 h-4 w-4" /> Stop ({elapsed}s)
                </Button>
              )}
              {upload.isPending && (
                <span className="text-xs text-muted-foreground">Uploading…</span>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border/60 bg-surface/60">
            <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">
              Saved recordings
            </div>
            {(list.data?.length ?? 0) === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No recordings yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {list.data!.map((r) => (
                  <li key={r.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })} ·{" "}
                          {Math.round((r.duration_ms ?? 0) / 1000)}s ·{" "}
                          {Math.round((r.size_bytes ?? 0) / 1024)} KB
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => play(r.id, r.storage_path)}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => del.mutate({ id: r.id, storage_path: r.storage_path })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {playing === r.id && playingUrl && (
                      <video
                        src={playingUrl}
                        controls
                        autoPlay
                        className="w-full rounded-md border border-border/60 bg-black"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <AgentActivity className="h-[60vh] md:h-full md:min-h-[500px]" />
      </div>
    </AppShell>
  );
}
