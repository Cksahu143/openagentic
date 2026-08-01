CREATE TABLE IF NOT EXISTS public.agent_vms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Main Computer',
  fs jsonb NOT NULL DEFAULT '{}'::jsonb,
  cwd text NOT NULL DEFAULT '/home/agent',
  terminal_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  installed_apps text[] NOT NULL DEFAULT '{terminal,editor,filesystem,code-runner,web-browser}',
  spec jsonb NOT NULL DEFAULT '{"cpu":"16 cores @ 3.8GHz","memory":"32GB RAM","storage":"500GB SSD","gpu":"24GB VRAM","os":"OpenAgent Linux"}'::jsonb,
  status text NOT NULL DEFAULT 'idle',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_vms TO authenticated;
GRANT ALL ON public.agent_vms TO service_role;
ALTER TABLE public.agent_vms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their VMs" ON public.agent_vms FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TABLE IF NOT EXISTS public.sub_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_session_id uuid REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  vm_id uuid REFERENCES public.agent_vms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  allowed_apps text[] NOT NULL DEFAULT '{terminal,filesystem,code-runner}',
  system_prompt text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sub_agents TO authenticated;
GRANT ALL ON public.sub_agents TO service_role;
ALTER TABLE public.sub_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their sub-agents" ON public.sub_agents FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_updated_at_agent_vms BEFORE UPDATE ON public.agent_vms FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_vms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sub_agents;