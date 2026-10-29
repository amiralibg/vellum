import { zodResolver } from "@hookform/resolvers/zod";
import { passwordResetSchema, type PasswordReset } from "@vellum/shared";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useResetInfo, useResetPassword } from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { ErrorIcon } from "../../components/icons";
import { AuthLayout } from "./AuthLayout";
import { LinkGone } from "./InvitePage";

/** /reset/:token: a one-time link an admin made for someone who forgot their password. */
export function ResetPage() {
  const token = useParams().token!;
  const info = useResetInfo(token);
  return (
    <AuthLayout labelledBy="invite-title">
      {info.isPending ? (
        <p className="text-text-muted" aria-busy="true">
          Checking the link…
        </p>
      ) : info.isError ? (
        <LinkGone title="This link doesn’t work" message={info.error.message} />
      ) : (
        <ResetForm token={token} email={info.data.email} />
      )}
    </AuthLayout>
  );
}

function ResetForm({ token, email }: { token: string; email: string }) {
  const reset = useResetPassword(token);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordReset>({ resolver: zodResolver(passwordResetSchema) });

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={handleSubmit(({ password }) => reset.mutate(password, { onSuccess: () => navigate("/", { replace: true }) }))}
    >
      <div>
        <h2 id="invite-title" className="text-h3 leading-[1.2] font-medium tracking-[-0.01em]">
          Choose a new password
        </h2>
        <p className="mt-1 text-text-secondary">
          For <span className="mono">{email}</span>. Every device signed in to this account is signed out.
        </p>
      </div>
      {/* Lets password managers save the new password under the right account. */}
      <input type="email" value={email} autoComplete="username" readOnly hidden />
      <div className="field">
        <label className="label" htmlFor="password">
          New password
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
      {reset.isError && (
        <p className="error" role="alert">
          <ErrorIcon />
          {reset.error.message}
        </p>
      )}
      <button className="btn btn-primary btn-lg" type="submit" disabled={reset.isPending}>
        {reset.isPending ? "Saving…" : "Set password and sign in"}
      </button>
    </form>
  );
}
