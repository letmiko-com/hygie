'use client';
// Client widgets of the devices screen: the pairing panel (the raw key
// arrives through the action state and lives only in this component's
// memory until the page is left) and the revoke confirmation.
import { useActionState, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { pairDeviceAction, type PairResult } from './actions';

export interface PairLabels {
  pairButton: string;
  formName: string;
  formNamePlaceholder: string;
  formPlatform: string;
  create: string;
  cancel: string;
  keyTitle: string;
  keyOnce: string;
  instructions: string;
  ingestUrlLabel: string;
  headerLabel: string;
  copy: string;
  copied: string;
  invalid: string;
  qrLater: string;
}

const fieldStyle: React.CSSProperties = {
  height: 'var(--control-h-md)',
  padding: '0 10px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text-1)',
  font: '400 var(--text-base)/1 var(--font-ui)',
};

function CopyButton({ value, copyLabel, copiedLabel }: { value: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="hy-btn hy-ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 8px',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border-strong)',
        background: 'transparent',
        color: copied ? 'var(--ok)' : 'var(--text-2)',
        font: '500 var(--text-xs)/1 var(--font-ui)',
        cursor: 'pointer',
      }}
    >
      <Icon name={copied ? 'check' : 'content_copy'} size={13} />
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}

export function PairPanel({ ingestUrl, labels }: { ingestUrl: string; labels: PairLabels }) {
  const [open, setOpen] = useState(false);
  const [result, formAction, pending] = useActionState<PairResult | null, FormData>(pairDeviceAction, null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="hy-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 'var(--control-h-md)',
            padding: '0 12px',
            borderRadius: 'var(--r-md)',
            border: '1px solid transparent',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            font: '500 var(--text-base)/1 var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          <Icon name="add" size={16} />
          {labels.pairButton}
        </button>
      </div>

      {open && !(result?.ok && result.rawKey) && (
        <form
          action={formAction}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 14,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span className="hy-label">{labels.formName}</span>
            <input name="name" required maxLength={80} placeholder={labels.formNamePlaceholder} style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 140 }}>
            <span className="hy-label">{labels.formPlatform}</span>
            <input name="platform" maxLength={40} placeholder="ios" style={fieldStyle} />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="hy-btn"
            style={{
              height: 'var(--control-h-md)',
              padding: '0 12px',
              borderRadius: 'var(--r-md)',
              border: '1px solid transparent',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              font: '500 var(--text-base)/1 var(--font-ui)',
              cursor: 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            {labels.create}
          </button>
          <button
            type="button"
            className="hy-btn hy-ghost"
            onClick={() => setOpen(false)}
            style={{
              height: 'var(--control-h-md)',
              padding: '0 12px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text-2)',
              font: '500 var(--text-base)/1 var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            {labels.cancel}
          </button>
          {result?.error === 'invalid' && (
            <span style={{ font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--danger)' }}>{labels.invalid}</span>
          )}
          <span style={{ flexBasis: '100%', font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
            {labels.qrLater}
          </span>
        </form>
      )}

      {result?.ok && result.rawKey && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--r-lg)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="key" size={17} color="var(--accent-strong)" />
            <span style={{ font: '600 var(--text-md)/1.2 var(--font-ui)' }}>
              {labels.keyTitle} {result.deviceName}
            </span>
          </div>
          <p style={{ margin: 0, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--danger)' }}>{labels.keyOnce}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <code
              className="tnum"
              style={{
                font: '600 var(--text-md)/1.3 var(--font-data)',
                letterSpacing: '0.04em',
                padding: '6px 10px',
                background: 'var(--surface-2)',
                borderRadius: 'var(--r-md)',
                wordBreak: 'break-all',
              }}
            >
              {result.rawKey}
            </code>
            <CopyButton value={result.rawKey} copyLabel={labels.copy} copiedLabel={labels.copied} />
          </div>
          <p style={{ margin: 0, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-2)' }}>{labels.instructions}</p>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="hy-label">{labels.ingestUrlLabel}</span>
              <code className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)' }}>{ingestUrl}</code>
              <CopyButton value={ingestUrl} copyLabel={labels.copy} copiedLabel={labels.copied} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="hy-label">{labels.headerLabel}</span>
              <code className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)' }}>X-Hygie-Device-Key</code>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeButton({ label, confirmText }: { label: string; confirmText: string }) {
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
        color: 'var(--danger)',
        font: '500 var(--text-sm)/1 var(--font-ui)',
        cursor: 'pointer',
      }}
    >
      <Icon name="link_off" size={15} />
      {label}
    </button>
  );
}
