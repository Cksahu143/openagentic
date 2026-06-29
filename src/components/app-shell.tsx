import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, User as UserIcon } from "lucide-react";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppShell({ children, title, subtitle, actions }: AppShellProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur md:px-5">
            <SidebarTrigger />
            <div className="ml-1 flex flex-1 flex-col leading-tight">
              {title && (
                <h1 className="text-sm font-semibold tracking-tight md:text-base">{title}</h1>
              )}
              {subtitle && (
                <p className="hidden text-xs text-muted-foreground md:block">{subtitle}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <Link
                to="/settings"
                className="hidden h-8 items-center gap-2 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex"
              >
                <UserIcon className="h-3.5 w-3.5" />
                <span className="max-w-[140px] truncate">{user?.email ?? "Account"}</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
