import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckIcon } from "./icons";

const ToastContext = createContext<(message: string) => void>(() => {});

/** One polite status region, updated in place ("Link copied"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<number>(undefined);
  const show = useCallback((next: string) => {
    setMessage(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(""), 2400);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">
        {message && (
          <div className="toast">
            <CheckIcon />
            {message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function useCopyLink() {
  const toast = useToast();
  return async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  };
}
