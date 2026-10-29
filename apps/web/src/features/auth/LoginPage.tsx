import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@vellum/shared";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useLogin, useMe } from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { ApiError } from "../../lib/api";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const { data: account } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (account) return <Navigate to={from} replace />;

  const onSubmit = handleSubmit((input) => login.mutate(input, { onSuccess: () => navigate(from, { replace: true }) }));
  const serverError = login.error instanceof ApiError ? login.error.message : login.error ? "Something went wrong." : "";
  return (
    <AuthLayout labelledBy="signin-title">
      <form className="grid gap-5" onSubmit={onSubmit} noValidate>
        <div>
          <h2 id="signin-title" className="text-h3 leading-[1.2] font-medium tracking-[-0.01em]">
            Sign in
          </h2>
          <p className="mt-1 text-text-secondary">Accounts are by invite. Ask an admin of this server for a link.</p>
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
    </AuthLayout>
  );
}
