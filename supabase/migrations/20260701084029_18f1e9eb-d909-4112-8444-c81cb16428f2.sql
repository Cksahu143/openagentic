
CREATE TABLE public.agent_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',
  task_tree JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_step INTEGER NOT NULL DEFAULT 0,
  tool_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  reasoning TEXT,
  active_tab_id INTEGER,
  current_url TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_sessions_user ON public.agent_sessions(user_id, last_activity_at DESC);
CREATE INDEX idx_agent_sessions_thread ON public.agent_sessions(thread_id);
CREATE INDEX idx_agent_sessions_status ON public.agent_sessions(user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_sessions TO authenticated;
GRANT ALL ON public.agent_sessions TO service_role;

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own agent sessions"
  ON public.agent_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER agent_sessions_set_updated_at
  BEFORE UPDATE ON public.agent_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_sessions;
