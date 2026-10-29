import { zodResolver } from "@hookform/resolvers/zod";
import { inviteAcceptSchema, type InviteAccept, type InviteInfo } from "@vellum/shared";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { useAcceptInvite, useInviteInfo } from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { ErrorIcon } from "../../components/icons";
import { ApiError } from "../../lib/api";
import { formatLongDate } from "../../lib/format";
import { AuthLayout } from "./AuthLayout";

/** /invite/:token: whoever opens it picks their own email, name and password. */
export function InvitePage() {
  const token = useParams().token!;
  const info = useInviteInfo(token);
  return (
    <AuthLayout labelledBy="invite-title">
      {info.isPending ? (
        <p className="text-text-muted" aria-busy="true">
          Checking the invite…
        </p>
      ) : info.isError ? (
        <LinkGone title="This invite doesn’t work" message={info.error.message} />
      ) : (
        <InviteForm token={token} {...info.data} />
      )}
    </AuthLayout>
  );
}

function InviteForm({ token, name, invitedBy, expiresAt }: { token: string } & InviteInfo) {
  const accept = useAcceptInvite(token);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<InviteAccept>({
    resolver: zodResolver(inviteAcceptSchema),
    // The admin's name for the invite is a starting point; readers see whatever they settle on.
    defaultValues: { displayName: name },
  });

  const onSubmit = handleSubmit((input) =>
    accept.mutate(input, {
      onSuccess: () => navigate("/", { replace: true }),
      onError: (err) => {
        if (!(err instanceof ApiError)) return;
        for (const [field, message] of Object.entries(err.fields)) {
          if (field in input) setError(field as keyof InviteAccept, { message }, { shouldFocus: true });
        }
      },
    }),
  );
  const formError = accept.error && !(accept.error instanceof ApiError && Object.keys(accept.error.fields).length);

  return (
    <form className="grid gap-5" onSubmit={onSubmit} noValidate>
      <div>
        <h2 id="invite-title" className="text-h3 leading-[1.2] font-medium tracking-[-0.01em]">
          {name ? `Welcome, ${name}` : "Create your account"}
        </h2>
        <p className="mt-1 text-text-secondary">
          {invitedBy} invited you to share documents from this server.{name ? " Create your account to start." : ""} The
          invite works once, until {formatLongDate(expiresAt)}.
        </p>
      </div>
      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          className="input"
          id="email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          aria-invalid={errors.email ? "true" : undefined}
          aria-describedby={errors.email ? "email-error" : "email-hint"}
          {...register("email")}
        />
        {errors.email ? (
          <FieldError id="email-error">{errors.email.message}</FieldError>
        ) : (
          <p className="hint" id="email-hint">
            You sign in with it. Vellum never emails you.
          </p>
        )}
      </div>
      <div className="field">
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input
          className="input"
          id="name"
          autoComplete="name"
          aria-invalid={errors.displayName ? "true" : undefined}
          aria-describedby={errors.displayName ? "name-error" : "name-hint"}
          {...register("displayName")}
        />
        {errors.displayName ? (
          <FieldError id="name-error">{errors.displayName.message}</FieldError>
        ) : (
          <p className="hint" id="name-hint">
            Readers see “Shared by” and this name.
          </p>
        )}
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          className="input"
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.password ? "true" : undefined}
          aria-describedby={errors.password ? "password-error" : "password-hint"}
          {...register("password")}
        />
        {errors.password ? (
          <FieldError id="password-error">{errors.password.message}</FieldError>
        ) : (
          <p className="hint" id="password-hint">
            At least 8 characters.
          </p>
        )}
      </div>
      {formError && (
        <p className="error" role="alert">
          <ErrorIcon />
          {accept.error.message}
        </p>
      )}
      <button className="btn btn-primary btn-lg" type="submit" disabled={accept.isPending}>
        {accept.isPending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

/** An invite or password link that was used, revoked or has expired. */
export function LinkGone({ title, message }: { title: string; message: string }) {
  return (
    <div className="grid gap-5">
      <div>
        <h2 id="invite-title" className="text-h3 leading-[1.2] font-medium tracking-[-0.01em]">
          {title}
        </h2>
        <p className="mt-1 text-text-secondary">{message}</p>
      </div>
      <Link className="btn btn-secondary justify-self-start" to="/login">
        Go to sign in
      </Link>
    </div>
  );
}
