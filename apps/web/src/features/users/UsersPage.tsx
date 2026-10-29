import * as Menu from "@radix-ui/react-dropdown-menu";
import type { CreatedInvite, IssuedLink, UserItem, UserListResponse } from "@vellum/shared";
import { useState } from "react";
import {
  useCreateInvite,
  useInvites,
  useMe,
  useResetLink,
  useRevokeInvite,
  useUpdateUser,
  useUsers,
} from "../../api/hooks";
import { CopyField } from "../../components/CopyField";
import { FieldError } from "../../components/FieldError";
import { DraftDot, ErrorIcon, LiveDot, MoreIcon, PlusIcon } from "../../components/icons";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Topbar } from "../../components/Topbar";
import { usageLines } from "../../components/Usage";
import { formatLongDate, formatNumber, formatUpdated } from "../../lib/format";

type Action = { kind: "limits" | "reset" | "disable"; user: UserItem };

/** Admins manage accounts here. They never see other users' documents or stats. */
export function UsersPage() {
  const { data, isPending, isError, error } = useUsers();
  const invites = useInvites();
  const [inviting, setInviting] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  // Quick actions (admin role, enable, revoke) report failures here; the toast is for success.
  const [failure, setFailure] = useState("");
  const pending = invites.data?.length ?? 0;
  const accounts = data?.users.length ?? 0;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar>
        <button className="btn btn-primary" type="button" onClick={() => setInviting(true)}>
          <PlusIcon />
          Invite
        </button>
      </Topbar>

      <main id="main" className="page">
        <h1 className="display text-h1 max-[960px]:text-[44px]">Users</h1>
        <p className="mt-3 text-body text-text-secondary">
          <span className="num">{formatNumber(accounts)}</span> {accounts === 1 ? "account" : "accounts"} ·{" "}
          <span className="num">{formatNumber(pending)}</span> {pending === 1 ? "invite" : "invites"} waiting
        </p>

        {failure && (
          <p className="error mt-6" role="alert">
            <ErrorIcon />
            {failure}
          </p>
        )}

        {pending > 0 && <PendingInvites onError={setFailure} />}

        <section className="mt-12" aria-labelledby="accounts-h">
          <h2 id="accounts-h" className="group-title">
            Accounts
          </h2>
          {isError ? (
            <p className="error py-8" role="alert">
              <ErrorIcon />
              {error.message}
            </p>
          ) : isPending ? (
            <div className="h-40" aria-busy="true" />
          ) : (
            <UserTable data={data} onAction={setAction} onError={setFailure} />
          )}
          <p className="hint mt-4">
            Documents stay private to the person who uploaded them, admins included. Disabling an account takes every
            document of theirs offline.
          </p>
        </section>
      </main>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      {data && (
        <>
          <LimitsDialog
            key={action?.kind === "limits" ? action.user.id : "limits"}
            user={action?.kind === "limits" ? action.user : null}
            defaults={data.defaults}
            onClose={() => setAction(null)}
          />
          <ResetLinkDialog
            key={action?.kind === "reset" ? action.user.id : "reset"}
            user={action?.kind === "reset" ? action.user : null}
            onClose={() => setAction(null)}
          />
          <DisableDialog
            key={action?.kind === "disable" ? action.user.id : "disable"}
            user={action?.kind === "disable" ? action.user : null} onClose={() => setAction(null)} />
        </>
      )}
    </>
  );
}

type OnError = (message: string) => void;

function UserTable({ data, onAction, onError }: { data: UserListResponse; onAction: (a: Action) => void; onError: OnError }) {
  const { data: me } = useMe();
  return (
    <div className="data-table-wrap mt-4">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Documents</th>
            <th scope="col">Storage</th>
            <th scope="col">Last active</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => (
            <UserRow key={u.id} user={u} self={u.id === me?.id} onAction={onAction} onError={onError} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  user: u,
  self,
  onAction,
  onError,
}: {
  user: UserItem;
  self: boolean;
  onAction: (a: Action) => void;
  onError: OnError;
}) {
  const update = useUpdateUser(u.id);
  const toast = useToast();
  const lines = usageLines(u.usage);
  const custom = u.limits.maxDocuments !== null || u.limits.maxStorageMb !== null;
  const setAdmin = (isAdmin: boolean) =>
    update.mutate(
      { isAdmin },
      {
        onSuccess: () => {
          onError("");
          toast(isAdmin ? `${u.displayName} is now an admin` : `${u.displayName} is no longer an admin`);
        },
        onError: (err) => onError(err.message),
      },
    );

  return (
    <tr>
      <td>
        <div className="flex items-center gap-2 font-medium">
          {u.displayName}
          {self && <span className="text-sm font-normal text-text-muted">(you)</span>}
          {u.isAdmin && <span className="badge">Admin</span>}
        </div>
        <div className="mono mt-1 text-sm text-text-muted">{u.email}</div>
      </td>
      <td className="num">{lines.documents}</td>
      <td className="num">
        {lines.storage}
        {custom && <small className="block text-xs text-text-muted">Own limits</small>}
      </td>
      <td className="text-text-secondary">{u.lastSeenAt ? formatUpdated(u.lastSeenAt) : "Never"}</td>
      <td>
        {u.disabled ? (
          <span className="status status-off">
            <DraftDot />
            Disabled
          </span>
        ) : (
          <span className="status status-live">
            <LiveDot />
            Active
          </span>
        )}
      </td>
      <td className="text-end">
        <Menu.Root>
          <Menu.Trigger className="btn btn-ghost btn-icon" aria-label={`More actions for ${u.displayName}`}>
            <MoreIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" align="end" sideOffset={4}>
              {u.isAdmin ? (
                <Menu.Item className="menu-item" onSelect={() => setAdmin(false)}>
                  {self ? "Step down as admin" : "Remove admin"}
                </Menu.Item>
              ) : (
                <Menu.Item className="menu-item" onSelect={() => setAdmin(true)} disabled={u.disabled}>
                  Make admin
                </Menu.Item>
              )}
              {!u.isAdmin && (
                <Menu.Item className="menu-item" onSelect={() => onAction({ kind: "limits", user: u })}>
                  Set limits…
                </Menu.Item>
              )}
              {!u.disabled && (
                <Menu.Item className="menu-item" onSelect={() => onAction({ kind: "reset", user: u })}>
                  New password link…
                </Menu.Item>
              )}
              {u.disabled ? (
                <Menu.Item
                  className="menu-item"
                  onSelect={() =>
                    update.mutate(
                      { disabled: false },
                      {
                        onSuccess: () => {
                          onError("");
                          toast(`Enabled ${u.displayName}`);
                        },
                        onError: (err) => onError(err.message),
                      },
                    )
                  }
                >
                  Enable account
                </Menu.Item>
              ) : (
                !self && (
                  <Menu.Item className="menu-item" onSelect={() => onAction({ kind: "disable", user: u })}>
                    Disable account…
                  </Menu.Item>
                )
              )}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </td>
    </tr>
  );
}

function PendingInvites({ onError }: { onError: OnError }) {
  const { data } = useInvites();
  const revoke = useRevokeInvite();
  const toast = useToast();
  return (
    <section className="mt-12" aria-labelledby="invites-h">
      <h2 id="invites-h" className="group-title">
        Waiting invites
      </h2>
      <ul className="m-0 mt-4 list-none p-0">
        {data?.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-3">
            <div>
              <div className={i.note ? "font-medium" : "text-text-muted"}>{i.note || "No name given"}</div>
              <div className="mt-1 text-sm text-text-muted">
                Made by {i.createdBy} · works until {formatLongDate(i.expiresAt)}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(i.id, {
                  onSuccess: () => {
                    onError("");
                    toast("Invite revoked. The link no longer works");
                  },
                  onError: (err) => onError(err.message),
                })
              }
            >
              Revoke{i.note ? <span className="visually-hidden"> invite for {i.note}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateInvite();
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const close = () => {
    onClose();
    setNote("");
    setCreated(null);
    create.reset();
  };
  return (
    <Modal open={open} onClose={close} labelledBy="invite-h" describedBy="invite-d">
      <h2 id="invite-h">{created ? "Send this link" : "Invite someone"}</h2>
      {created ? (
        <>
          <p id="invite-d">
            Whoever opens it first can create one account with their own email and password. It works until{" "}
            {formatLongDate(created.expiresAt)}. You won’t see this link again.
          </p>
          <div className="mt-6">
            <CopyField id="invite-url" label="Invite link" url={created.url} />
          </div>
          <form method="dialog" className="actions">
            <button className="btn btn-ink" type="submit" autoFocus>
              Done
            </button>
          </form>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(note, { onSuccess: setCreated });
          }}
        >
          <p id="invite-d">
            Vellum makes a link for you to send yourself; it doesn’t send email. The link works once, for 7 days.
          </p>
          <div className="field mt-6">
            <label className="label" htmlFor="invite-note">
              Their name <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <input
              className="input"
              id="invite-note"
              value={note}
              maxLength={80}
              placeholder="Sara"
              autoComplete="off"
              aria-describedby="invite-note-hint"
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="hint" id="invite-note-hint">
              The invite page greets them with “Welcome, {note.trim() || "Sara"}” and fills in their name. They can
              change it.
            </p>
          </div>
          {create.isError && (
            <p className="error mt-4" role="alert">
              <ErrorIcon />
              {create.error.message}
            </p>
          )}
          <div className="actions">
            <button className="btn btn-secondary" type="button" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-ink" type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create invite link"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Blank means the default from USER_MAX_DOCUMENTS / USER_MAX_STORAGE_MB. */
function LimitsDialog({
  user,
  defaults,
  onClose,
}: {
  user: UserItem | null;
  defaults: UserListResponse["defaults"];
  onClose: () => void;
}) {
  const update = useUpdateUser(user?.id ?? "");
  const toast = useToast();
  const [docs, setDocs] = useState(user?.limits.maxDocuments?.toString() ?? "");
  const [mb, setMb] = useState(user?.limits.maxStorageMb?.toString() ?? "");
  const [errors, setErrors] = useState<{ docs?: string; mb?: string }>({});

  const parse = (v: string) => (v.trim() === "" ? null : Number(v));
  const check = (v: number | null, what: string) =>
    v !== null && (!Number.isInteger(v) || v < 1) ? `Enter a whole number of ${what}, or leave it blank.` : undefined;

  return (
    <Modal open={user !== null} onClose={onClose} labelledBy="limits-h" describedBy="limits-d">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const maxDocuments = parse(docs);
          const maxStorageMb = parse(mb);
          const next = { docs: check(maxDocuments, "documents"), mb: check(maxStorageMb, "megabytes") };
          setErrors(next);
          if (next.docs || next.mb) return;
          update.mutate(
            { maxDocuments, maxStorageMb },
            {
              onSuccess: () => {
                onClose();
                toast(`Saved limits for ${user!.displayName}`);
              },
            },
          );
        }}
      >
        <h2 id="limits-h">Limits for {user?.displayName}</h2>
        <p id="limits-d">Leave a field blank to use the server’s default. Lowering a limit never deletes anything.</p>
        <div className="mt-6 grid grid-cols-2 gap-4 max-[520px]:grid-cols-1">
          <div className="field">
            <label className="label" htmlFor="max-docs">
              Documents
            </label>
            <input
              className="input num"
              id="max-docs"
              inputMode="numeric"
              value={docs}
              placeholder={String(defaults.maxDocuments)}
              aria-invalid={errors.docs ? "true" : undefined}
              aria-describedby={errors.docs ? "max-docs-error" : "max-docs-hint"}
              onChange={(e) => setDocs(e.target.value)}
            />
            {errors.docs ? (
              <FieldError id="max-docs-error">{errors.docs}</FieldError>
            ) : (
              <p className="hint" id="max-docs-hint">
                Default {formatNumber(defaults.maxDocuments)}
              </p>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="max-mb">
              Storage in MB
            </label>
            <input
              className="input num"
              id="max-mb"
              inputMode="numeric"
              value={mb}
              placeholder={String(defaults.maxStorageMb)}
              aria-invalid={errors.mb ? "true" : undefined}
              aria-describedby={errors.mb ? "max-mb-error" : "max-mb-hint"}
              onChange={(e) => setMb(e.target.value)}
            />
            {errors.mb ? (
              <FieldError id="max-mb-error">{errors.mb}</FieldError>
            ) : (
              <p className="hint" id="max-mb-hint">
                Default {formatNumber(defaults.maxStorageMb)} MB
              </p>
            )}
          </div>
        </div>
        {update.isError && (
          <p className="error mt-4" role="alert">
            <ErrorIcon />
            {update.error.message}
          </p>
        )}
        <div className="actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-ink" type="submit" disabled={update.isPending}>
            Save limits
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetLinkDialog({ user, onClose }: { user: UserItem | null; onClose: () => void }) {
  const issue = useResetLink(user?.id ?? "");
  const [link, setLink] = useState<IssuedLink | null>(null);
  return (
    <Modal open={user !== null} onClose={onClose} labelledBy="reset-h" describedBy="reset-d">
      <h2 id="reset-h">New password link for {user?.displayName}</h2>
      {link ? (
        <>
          <p id="reset-d">
            Send it to {user?.displayName} yourself. It works once, until {formatLongDate(link.expiresAt)}, and signs out
            every device on their account. You won’t see it again.
          </p>
          <div className="mt-6">
            <CopyField id="reset-url" label="Password link" url={link.url} />
          </div>
          <form method="dialog" className="actions">
            <button className="btn btn-ink" type="submit" autoFocus>
              Done
            </button>
          </form>
        </>
      ) : (
        <>
          <p id="reset-d">
            For when they forgot their password. Their current password keeps working until they use the link, and any
            earlier link for them stops working now.
          </p>
          {issue.isError && (
            <p className="error mt-4" role="alert">
              <ErrorIcon />
              {issue.error.message}
            </p>
          )}
          <div className="actions">
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-ink"
              type="button"
              disabled={issue.isPending}
              onClick={() => issue.mutate(undefined, { onSuccess: setLink })}
            >
              {issue.isPending ? "Creating…" : "Create link"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function DisableDialog({ user, onClose }: { user: UserItem | null; onClose: () => void }) {
  const update = useUpdateUser(user?.id ?? "");
  const toast = useToast();
  return (
    <Modal open={user !== null} onClose={onClose} labelledBy="disable-h" describedBy="disable-d">
      <h2 id="disable-h">Disable {user?.displayName}?</h2>
      <p id="disable-d">
        They’re signed out and can’t sign in. Every link they shared shows “not found” until you enable the account again.
        Nothing is deleted.
      </p>
      {update.isError && (
        <p className="error mt-4" role="alert">
          <ErrorIcon />
          {update.error.message}
        </p>
      )}
      <form method="dialog" className="actions">
        <button className="btn btn-secondary" type="submit" autoFocus>
          Cancel
        </button>
        <button
          className="btn btn-ink"
          type="button"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { disabled: true },
              {
                onSuccess: () => {
                  onClose();
                  toast(`Disabled ${user!.displayName}. Their links are offline`);
                },
              },
            )
          }
        >
          {update.isPending ? "Disabling…" : "Disable account"}
        </button>
      </form>
    </Modal>
  );
}
