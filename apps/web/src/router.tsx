import { useEffect } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "./api/hooks";
import { ToastProvider } from "./components/Toast";
import { InvitePage } from "./features/auth/InvitePage";
import { LoginPage } from "./features/auth/LoginPage";
import { ResetPage } from "./features/auth/ResetPage";
import { DocumentPage } from "./features/document/DocumentPage";
import { ViewsPage } from "./features/document/ViewsPage";
import { DocumentsPage } from "./features/documents/DocumentsPage";
import { PublishPage } from "./features/publish/PublishPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { UsersPage } from "./features/users/UsersPage";
import { setThemePreference } from "./lib/theme";

function RequireUser() {
  const { data: account, isPending } = useMe();
  const location = useLocation();
  useEffect(() => {
    if (account) setThemePreference(account.theme);
  }, [account]);
  if (isPending) return null;
  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

function RequireAdmin() {
  const { data: account } = useMe();
  return account?.isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/invite/:token", element: <InvitePage /> },
  { path: "/reset/:token", element: <ResetPage /> },
  {
    element: <RequireUser />,
    children: [
      { path: "/", element: <DocumentsPage /> },
      { path: "/documents/:id", element: <DocumentPage /> },
      { path: "/documents/:id/publish", element: <PublishPage /> },
      { path: "/documents/:id/views", element: <ViewsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { element: <RequireAdmin />, children: [{ path: "/users", element: <UsersPage /> }] },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
