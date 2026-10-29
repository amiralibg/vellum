import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../api/hooks";
import { initial } from "../lib/format";
import { LogoIcon } from "./icons";

export function Topbar({ children, wide }: { children?: ReactNode; wide?: boolean }) {
  const path = useLocation().pathname;
  const { data: account } = useMe();
  // Document pages count as "Documents", as in mockups/document.html.
  const section = path.startsWith("/settings") ? "settings" : path.startsWith("/users") ? "users" : "documents";
  const current = (s: typeof section) => (section === s ? "page" : undefined);
  return (
    <header className="topbar">
      <div className="topbar-inner" style={wide ? { maxWidth: "none" } : undefined}>
        <Link className="wordmark" to="/">
          <LogoIcon />
          Vellum
        </Link>
        <nav aria-label="Main" className="max-[960px]:hidden">
          <Link to="/" aria-current={current("documents")}>
            Documents
          </Link>
          {account?.isAdmin && (
            <Link to="/users" aria-current={current("users")}>
              Users
            </Link>
          )}
          <Link to="/settings" aria-current={current("settings")}>
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
  const { data: account } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const name = account?.displayName ?? "";
  return (
    <Menu.Root>
      <Menu.Trigger className="avatar cursor-pointer border-0" aria-label={`Account menu, signed in as ${name}`}>
        {initial(name)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={8}>
          <div className="px-3 py-2 text-sm text-text-muted">{account?.email}</div>
          {account?.isAdmin && (
            <Menu.Item className="menu-item" onSelect={() => navigate("/users")}>
              Users
            </Menu.Item>
          )}
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
