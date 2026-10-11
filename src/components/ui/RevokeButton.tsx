'use client';
// Submit button with a native confirmation: revoking a device key (the
// member's Devices screen, and the Administration section for a lost phone),
// disabling or re-enabling a member. Cancelling the dialog cancels the submit.
import { Icon } from '@/components/ui/Icon';

export function RevokeButton({
  label,
  confirmText,
  icon = 'link_off',
  tone = 'danger',
}: {
  label: string;
  confirmText: string;
  icon?: string;
  tone?: 'danger' | 'neutral';
}) {
  return (
    <button
      type="submit"
      className="hy-btn hy-ghost"
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 26,
        padding: '0 9px',
        borderRadius: 'var(--r-md)',
        border: 'none',
        background: 'transparent',
        color: tone === 'danger' ? 'var(--danger)' : 'var(--accent)',
        font: '500 var(--text-sm)/1 var(--font-ui)',
        cursor: 'pointer',
      }}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}
