
CREATE TABLE public.provider_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT,
  base_url TEXT,
  api_key TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_keys TO authenticated;
GRANT ALL ON public.provider_keys TO service_role;
ALTER TABLE public.provider_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own provider_keys" ON public.provider_keys
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER provider_keys_updated_at BEFORE UPDATE ON public.provider_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Storage policies: user can only touch objects under their own user_id/ prefix
CREATE POLICY "user-files read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "user-files insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "user-files update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "user-files delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);
