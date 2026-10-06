import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  extraActions?: ReactNode;
  children: ReactNode;
};

/** ネイティブ <dialog> を使ったモーダルフォーム */
export function Dialog({ title, onClose, onSubmit, submitLabel = '保存', busy, error, extraActions, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <dialog ref={ref} onCancel={(e) => (e.preventDefault(), onClose())}>
      <form onSubmit={submit}>
        <h2>{title}</h2>
        {error && <div className="error">{error}</div>}
        {children}
        <div className="dialog-actions">
          {extraActions}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>キャンセル</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? '保存中…' : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
