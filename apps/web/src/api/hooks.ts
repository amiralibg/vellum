import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Account,
  AccountSettings,
  CreatedInvite,
  DocumentDetail,
  DocumentListResponse,
  DocumentPreview,
  DocumentSettingsPatch,
  DocumentStats,
  InviteAccept,
  InviteInfo,
  InviteItem,
  IssuedLink,
  LoginInput,
  PasswordChange,
  ResetInfo,
  SlugAvailability,
  UserListResponse,
  UserPatch,
  VersionListItem,
  ViewsPage,
} from "@vellum/shared";
import { api, ApiError } from "../lib/api";

export type ListFilter = "all" | "live" | "drafts" | "expired";

export const keys = {
  me: ["me"] as const,
  documents: (filter: ListFilter, q: string) => ["documents", filter, q] as const,
  document: (id: string) => ["document", id] as const,
  preview: (id: string) => ["document", id, "preview"] as const,
  versions: (id: string) => ["document", id, "versions"] as const,
  slug: (slug: string, except?: string) => ["slug", slug, except] as const,
  stats: (id: string) => ["document", id, "stats"] as const,
  views: (id: string, page: number) => ["document", id, "views", page] as const,
  users: ["admin", "users"] as const,
  invites: ["admin", "invites"] as const,
  invite: (token: string) => ["invite", token] as const,
  reset: (token: string) => ["reset", token] as const,
};

/** The user's zone, so "today", the 14 days and "this month" are their days, not the server's. */
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api.get<{ account: Account }>("/auth/me")).data.account;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** After signing in as someone, possibly not who was signed in before: nothing cached may carry over. */
function useSignedIn() {
  const qc = useQueryClient();
  return (account: Account) => {
    qc.clear();
    qc.setQueryData(keys.me, account);
  };
}

export function useLogin() {
  const onSuccess = useSignedIn();
  return useMutation({
    mutationFn: async (input: LoginInput) => (await api.post<{ account: Account }>("/auth/login", input)).data.account,
    onSuccess,
  });
}

/** What the invite page shows; an error when the link no longer works. */
export function useInviteInfo(token: string) {
  return useQuery({
    queryKey: keys.invite(token),
    queryFn: async () => (await api.get<InviteInfo>(`/auth/invites/${encodeURIComponent(token)}`)).data,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useAcceptInvite(token: string) {
  const onSuccess = useSignedIn();
  return useMutation({
    mutationFn: async (input: InviteAccept) =>
      (await api.post<{ account: Account }>(`/auth/invites/${encodeURIComponent(token)}`, input)).data.account,
    onSuccess,
  });
}

export function useResetInfo(token: string) {
  return useQuery({
    queryKey: keys.reset(token),
    queryFn: async () => (await api.get<ResetInfo>(`/auth/resets/${encodeURIComponent(token)}`)).data,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useResetPassword(token: string) {
  const onSuccess = useSignedIn();
  return useMutation({
    mutationFn: async (password: string) =>
      (await api.post<{ account: Account }>(`/auth/resets/${encodeURIComponent(token)}`, { password })).data.account,
    onSuccess,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}

export function useDocuments(filter: ListFilter, q: string) {
  return useQuery({
    queryKey: keys.documents(filter, q),
    queryFn: async () => (await api.get<DocumentListResponse>("/documents", { params: { status: filter, q, tz } })).data,
    placeholderData: keepPreviousData,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: keys.document(id),
    queryFn: async () => (await api.get<DocumentDetail>(`/documents/${id}`)).data,
  });
}

export function useDocumentStats(id: string) {
  return useQuery({
    queryKey: keys.stats(id),
    queryFn: async () => (await api.get<DocumentStats>(`/documents/${id}/stats`, { params: { tz } })).data,
  });
}

export function useDocumentViews(id: string, page: number) {
  return useQuery({
    queryKey: keys.views(id, page),
    queryFn: async () => (await api.get<ViewsPage>(`/documents/${id}/views`, { params: { page } })).data,
    placeholderData: keepPreviousData,
  });
}

export function usePreview(id: string) {
  return useQuery({
    queryKey: keys.preview(id),
    queryFn: async () => (await api.get<DocumentPreview>(`/documents/${id}/preview`)).data,
    // HTML previews carry a one-hour owner token; refetching would reload the frame for nothing.
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<DocumentDetail>("/documents", form)).data;
    },
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(doc.id), doc);
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: keys.me }); // usage
    },
  });
}

export function useUpdateDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: DocumentSettingsPatch) => (await api.patch<DocumentDetail>(`/documents/${id}`, patch)).data,
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function usePublish(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<DocumentDetail>(`/documents/${id}/publish`)).data,
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useUnpublish(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<DocumentDetail>(`/documents/${id}/unpublish`)).data,
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useDeleteDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/documents/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.document(id) });
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: keys.me }); // usage
    },
  });
}

export function useVersions(id: string) {
  return useQuery({
    queryKey: keys.versions(id),
    queryFn: async () => (await api.get<VersionListItem[]>(`/documents/${id}/versions`)).data,
  });
}

/** After a new or restored version: the document, its preview and its version list all change. */
function useVersionChanged(id: string) {
  const qc = useQueryClient();
  return (doc: DocumentDetail) => {
    qc.setQueryData(keys.document(id), doc);
    void qc.invalidateQueries({ queryKey: keys.preview(id) });
    void qc.invalidateQueries({ queryKey: keys.versions(id) });
    void qc.invalidateQueries({ queryKey: ["documents"] });
    void qc.invalidateQueries({ queryKey: keys.me }); // usage
  };
}

export function useUploadVersion(id: string) {
  const onSuccess = useVersionChanged(id);
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<DocumentDetail>(`/documents/${id}/versions`, form)).data;
    },
    onSuccess,
  });
}

export function useRestoreVersion(id: string) {
  const onSuccess = useVersionChanged(id);
  return useMutation({
    mutationFn: async (versionId: string) =>
      (await api.post<DocumentDetail>(`/documents/${id}/versions/${versionId}/restore`)).data,
    onSuccess,
  });
}

export function useSlugAvailability(slug: string, except?: string) {
  return useQuery({
    queryKey: keys.slug(slug, except),
    queryFn: async () =>
      (await api.get<SlugAvailability>(`/slugs/${encodeURIComponent(slug)}`, { params: { except } })).data,
    enabled: slug.length > 0,
    staleTime: 10_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AccountSettings) =>
      (await api.patch<{ account: Account }>("/settings", settings)).data.account,
    onSuccess: (account) => qc.setQueryData(keys.me, account),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: PasswordChange) => {
      await api.put("/settings/password", input);
    },
  });
}

// --- Admin

export function useUsers() {
  return useQuery({
    queryKey: keys.users,
    queryFn: async () => (await api.get<UserListResponse>("/admin/users")).data,
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UserPatch) => (await api.patch(`/admin/users/${id}`, patch)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.users });
      // Stepping down yourself changes what you may see.
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useResetLink(id: string) {
  return useMutation({
    mutationFn: async () => (await api.post<IssuedLink>(`/admin/users/${id}/reset-link`)).data,
  });
}

export function useInvites() {
  return useQuery({
    queryKey: keys.invites,
    queryFn: async () => (await api.get<InviteItem[]>("/admin/invites")).data,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: string) => (await api.post<CreatedInvite>("/admin/invites", { note })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/invites/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  });
}
