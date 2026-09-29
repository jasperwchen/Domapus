import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalContainer } from "./modal-context";

export function Modal({ children, label, onClose, className, busy = false }: {
  children: ReactNode; label: string; onClose: () => void; className?: string; busy?: boolean;
}) {
  const [element, setElement] = useState<HTMLDialogElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [element]);
  return createPortal(
    <dialog ref={setElement} aria-label={label} aria-modal="true" className={className}
      style={{ margin: 0, width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none",
        padding: 0, border: 0 }}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <ModalContainer.Provider value={element}>{children}</ModalContainer.Provider>
    </dialog>, document.body,
  );
}
