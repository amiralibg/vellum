import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../api/hooks";
import { initial } from "../lib/format";
import { LogoIcon } from "./icons";

export function Topbar({ children, wide }: { children?: ReactNode; wide?: boolean }) {
  const inSettings = useLocation().pathname.startsWith("/settings");
  return (
    <header className="topbar">
      <div className="topbar-inner" style={wide ? { maxWidth: "none" } : undefined}>
        <Link className="wordmark" to="/">
          <LogoIcon />
          Vellum
        </Link>
        <nav aria-label="Main" className="max-[960px]:hidden">
          {/* Document pages count as "Documents", as in mockups/document.html. */}
          <Link to="/" aria-current={inSettings ? undefined : "page"}>
            Documents
          </Link>
          <Link to="/settings" aria-current={inSettings ? "page" : undefined}>
            Settings
          </Link>
        </nav>
        <span className="spacer" />
        {children}
        <AccountMenu />
      </div>
    </header>
  );
}

export function AccountMenu() {
  const { data: owner } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const name = owner?.displayName ?? "";
  return (
    <Menu.Root>
      <Menu.Trigger className="avatar cursor-pointer border-0" aria-label={`Account menu, signed in as ${name}`}>
        {initial(name)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={8}>
          <div className="px-3 py-2 text-sm text-text-muted">{owner?.email}</div>
          <Menu.Item className="menu-item" onSelect={() => navigate("/settings")}>
            Settings
          </Menu.Item>
          <Menu.Item
            className="menu-item"
            onSelect={() => logout.mutate(undefined, { onSuccess: () => navigate("/login", { replace: true }) })}
          >
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
