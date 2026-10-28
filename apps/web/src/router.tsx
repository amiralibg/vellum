import { useEffect } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "./api/hooks";
import { ToastProvider } from "./components/Toast";
import { LoginPage } from "./features/auth/LoginPage";
import { DocumentPage } from "./features/document/DocumentPage";
import { ViewsPage } from "./features/document/ViewsPage";
import { DocumentsPage } from "./features/documents/DocumentsPage";
import { PublishPage } from "./features/publish/PublishPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { setThemePreference } from "./lib/theme";

function RequireOwner() {
  const { data: owner, isPending } = useMe();
  const location = useLocation();
  useEffect(() => {
    if (owner) setThemePreference(owner.theme);
  }, [owner]);
  if (isPending) return null;
  if (!owner) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireOwner />,
    children: [
      { path: "/", element: <DocumentsPage /> },
      { path: "/documents/:id", element: <DocumentPage /> },
      { path: "/documents/:id/publish", element: <PublishPage /> },
      { path: "/documents/:id/views", element: <ViewsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
