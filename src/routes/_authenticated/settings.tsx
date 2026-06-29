import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · OpenAgent" }] }),
  component: Settings,
});

function Settings() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from("profiles")
      .select("display_name, bio")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? "");
        setBio(data?.bio ?? "");
        setLoading(false);
      });
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: displayName || null, bio: bio || null });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
  }

  return (
    <AppShell title="Settings" subtitle="Profile and workspace preferences">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6">
        <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <h2 className="text-sm font-semibold">Profile</h2>
          <p className="mt-1 text-xs text-muted-foreground">Visible to you only for now.</p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user?.email ?? ""} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dn">Display name</Label>
              <Input
                id="dn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>
            <Button onClick={save} disabled={saving || loading}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <h2 className="text-sm font-semibold">Workspace</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="font-mono text-xs uppercase tracking-wider">Theme:</span> Dark
              (default). Theme switcher will arrive with the design polish milestone.
            </li>
            <li>
              <span className="font-mono text-xs uppercase tracking-wider">Region:</span>{" "}
              automatically inferred.
            </li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
