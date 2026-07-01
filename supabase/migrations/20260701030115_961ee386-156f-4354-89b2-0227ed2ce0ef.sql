
-- Companion devices (browser extension pairings)
CREATE TABLE public.companion_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'browser-extension',
  token_hash TEXT NOT NULL,
  last_seen TIMESTAMPTZ,
  pairing_code TEXT,
  paired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_devices TO authenticated;
GRANT ALL ON public.companion_devices TO service_role;
ALTER TABLE public.companion_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own devices" ON public.companion_devices FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Companion commands queue
CREATE TABLE public.companion_commands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.companion_devices(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | error
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.companion_commands (user_id, status, created_at DESC);
CREATE INDEX ON public.companion_commands (device_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_commands TO authenticated;
GRANT ALL ON public.companion_commands TO service_role;
ALTER TABLE public.companion_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own commands" ON public.companion_commands FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER tg_companion_commands_updated_at BEFORE UPDATE ON public.companion_commands
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.companion_commands;
ALTER TABLE public.companion_commands REPLICA IDENTITY FULL;

-- Screen recordings
CREATE TABLE public.screen_recordings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  duration_ms INTEGER,
  size_bytes BIGINT,
  mime_type TEXT NOT NULL DEFAULT 'video/webm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screen_recordings TO authenticated;
GRANT ALL ON public.screen_recordings TO service_role;
ALTER TABLE public.screen_recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recordings" ON public.screen_recordings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Installed plugins
CREATE TABLE public.installed_plugins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, plugin_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installed_plugins TO authenticated;
GRANT ALL ON public.installed_plugins TO service_role;
ALTER TABLE public.installed_plugins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own plugins" ON public.installed_plugins FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Also enable realtime on activity_logs so the UI can stream agent activity
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;
