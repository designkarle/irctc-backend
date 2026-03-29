import { useEffect } from 'react';
import Button from './Button';

export default function Modal({ open, onClose, title, children, confirmText = 'Confirm', onConfirm, loading, danger }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        {title && <h3 className="text-lg font-semibold mb-3">{title}</h3>}
        <div className="text-sm text-gray-600 mb-6">{children}</div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {onConfirm && (
            <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
              {confirmText}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
