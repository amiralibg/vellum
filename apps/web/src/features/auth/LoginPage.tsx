import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@vellum/shared";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useLogin, useMe } from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { LogoIcon } from "../../components/icons";
import { ApiError } from "../../lib/api";

export function LoginPage() {
  const { data: owner } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (owner) return <Navigate to={from} replace />;

  const onSubmit = handleSubmit((input) => login.mutate(input, { onSuccess: () => navigate(from, { replace: true }) }));
  const serverError = login.error instanceof ApiError ? login.error.message : login.error ? "Something went wrong." : "";
  const host = window.location.host;

  return (
    <main className="grid min-h-dvh grid-cols-[1.35fr_1fr] max-[880px]:grid-cols-1">
      <section
        className="flex flex-col justify-between border-e border-line px-12 py-10 max-[880px]:gap-10 max-[880px]:border-e-0 max-[880px]:border-b max-[880px]:px-6 max-[880px]:py-8"
        aria-labelledby="pitch-title"
      >
        <Link className="wordmark" to="/login">
          <LogoIcon />
          Vellum
        </Link>
        <div>
          <h1 id="pitch-title" className="display max-w-[11ch] text-[clamp(56px,7.4vw,var(--text-display))]">
            Send a link, <em className="text-text-secondary not-italic">not an attachment.</em>
          </h1>
          <p className="mt-6 max-w-[44ch] text-lg text-pretty text-text-secondary">
            Upload a proposal, pitch or report as Markdown or HTML. Vellum renders it and gives you one link to share, on
            your own server.
          </p>
          <div
            className="mt-10 inline-flex items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-3 font-mono text-ui"
            aria-hidden="true"
          >
            <span>
              {host}/p/<b>your-proposal</b>
            </span>
          </div>
        </div>
        <p className="text-sm text-text-muted">Self-hosted · v0.1</p>
      </section>

      <section className="grid place-items-center bg-surface px-6 py-10" aria-labelledby="signin-title">
        <form className="grid w-full max-w-[360px] gap-5" onSubmit={onSubmit} noValidate>
          <div>
            <h2 id="signin-title" className="text-h3 leading-[1.2] font-medium tracking-[-0.01em]">
              Sign in
            </h2>
            <p className="mt-1 text-text-secondary">Only the owner of this server can sign in.</p>
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
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            {errors.email && <FieldError id="email-error">{errors.email.message}</FieldError>}
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              className="input"
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password || serverError ? "true" : undefined}
              aria-describedby={errors.password || serverError ? "password-error" : undefined}
              {...register("password")}
            />
            {(errors.password || serverError) && (
              <FieldError id="password-error">{errors.password?.message ?? serverError}</FieldError>
            )}
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

