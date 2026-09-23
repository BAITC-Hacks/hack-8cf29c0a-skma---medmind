import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  children,
  onClose,
  labelledBy,
  drawer = false,
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`border border-border bg-surface p-0 text-text-primary backdrop:bg-page-bg backdrop:opacity-75 ${drawer ? 'm-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-l-3xl' : 'w-[calc(100%-2rem)] max-w-md rounded-3xl'}`}
    >
      <div className={drawer ? 'flex min-h-full flex-col' : 'p-6 sm:p-8'}>{children}</div>
    </dialog>
  );
}
