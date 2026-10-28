import type { ReactNode } from "react";
import { ErrorIcon } from "./icons";

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="error" id={id}>
      <ErrorIcon />
      {children}
    </p>
  );
}
