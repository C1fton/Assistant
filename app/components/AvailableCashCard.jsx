'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, WalletCards } from 'lucide-react';
import { isString } from 'lodash';

import { useStorageStore } from '@/app/stores/storageStore';
import { formatMoney } from '@/lib/utils';

const normalizeDraft = (value) => {
  const raw = isString(value) ? value.replace(/,/g, '').trim() : String(value ?? '');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 0;
};

export default function AvailableCashCard({ className = '' }) {
  const availableCash = useStorageStore((state) => state.availableCash);
  const setAvailableCash = useStorageStore((state) => state.setAvailableCash);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(availableCash > 0 ? String(availableCash) : '');
  }, [availableCash]);

  const formattedCash = useMemo(() => formatMoney(availableCash || 0, 2), [availableCash]);

  const commitDraft = () => {
    setAvailableCash(normalizeDraft(draft));
  };

  return (
    <div className={`glass card available-cash-card ${className}`}>
      <div className="available-cash-main">
        <div className="available-cash-icon" aria-hidden="true">
          <WalletCards size={18} />
        </div>
        <div className="available-cash-copy">
          <div className="available-cash-label">流动可使用资金</div>
          <div className="available-cash-value">¥ {formattedCash}</div>
          <div className="available-cash-note">AI 建议会按这笔资金控制加仓上限</div>
        </div>
      </div>
      <div className="available-cash-editor">
        <span className="available-cash-prefix">¥</span>
        <input
          className="available-cash-input no-zoom"
          inputMode="decimal"
          value={draft}
          placeholder="0.00"
          aria-label="输入流动可使用资金"
          onChange={(event) => setDraft(event.target.value.replace(/[^\d.]/g, ''))}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitDraft();
              event.currentTarget.blur();
            }
          }}
        />
        <button type="button" className="available-cash-save" onClick={commitDraft} aria-label="保存流动可使用资金">
          <Check size={15} />
        </button>
      </div>
    </div>
  );
}
