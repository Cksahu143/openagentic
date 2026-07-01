
ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS observation_summary text,
  ADD COLUMN IF NOT EXISTS page_summary text,
  ADD COLUMN IF NOT EXISTS browser_memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS waiting_status text,
  ADD COLUMN IF NOT EXISTS recovery_status text,
  ADD COLUMN IF NOT EXISTS screenshots jsonb NOT NULL DEFAULT '[]'::jsonb;
