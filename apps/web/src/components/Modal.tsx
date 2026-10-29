import { useEffect, useRef, type ReactNode } from "react";

/**
 * The confirmation dialog of DocumentPage, controlled by `open`. showModal() makes the page
 * inert, moves focus inside, closes on Escape and returns focus to the trigger.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={labelledBy} aria-describedby={describedBy} onClose={onClose}>
      {open && children}
    </dialog>
  );
}
