import axios, { AxiosError } from "axios";
import type { ApiError as ApiErrorBody } from "@vellum/shared";

/** A failed API call, with the server's message and any per-field errors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const api = axios.create({ baseURL: "/api", withCredentials: true });

api.interceptors.response.use(undefined, (err: AxiosError<ApiErrorBody>) => {
  const status = err.response?.status ?? 0;
  const body = err.response?.data?.error;
  const message = body?.message ?? (status ? "Something went wrong. Try again." : "Can’t reach the server. Check your connection.");
  return Promise.reject(new ApiError(status, message, body?.fields));
});
