import { Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type OrderDetail, type RefundPreview } from '../api';
import { Button, Card, CardHeader, ErrorAlert } from './ui';
import { formatMoney } from '../format';

interface Props {
  order: OrderDetail;
  onRefunded: () => void;
}

export function RefundPanel({ order, onRefunded }: Props) {
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const items = Object.entries(quantities)
    .map(([orderItemId, quantity]) => ({ orderItemId: Number(orderItemId), quantity }))
    .filter((item) => item.quantity > 0);
  const itemsKey = JSON.stringify(items);

  // The amount comes from the server so what staff confirm is exactly what will be refunded.
  useEffect(() => {
    setConfirming(false);
    // Drop the old amount at once so "Review refund" stays off until the preview for these quantities arrives.
    setPreview(null);
    if (items.length === 0) {
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .previewRefund(order.id, { items }, controller.signal)
        .then((result) => {
          setPreview(result);
          setError(null);
        })
        .catch((e: Error) => {
          if (controller.signal.aborted) return;
          setPreview(null);
          setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, itemsKey]);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      await api.createRefund(order.id, { items, reason: reason.trim() || undefined });
      setQuantities({});
      setReason('');
      setPreview(null);
      setConfirming(false);
      onRefunded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Refund" subtitle="Choose how many units to return. They go back into stock." />
      <div className="card-body form-stack">
        <div className="line-items">
          {order.items.map((item) => {
            const refundable = item.quantity - item.refundedQuantity;
            return (
              <div key={item.id} className="refund-line">
                <div>
                  <div className="cell-primary">{item.name}</div>
                  <div className="cell-secondary">
                    {refundable} of {item.quantity} refundable
                  </div>
                </div>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={refundable}
                  disabled={refundable === 0}
                  aria-label={`Units of ${item.name} to refund`}
                  value={quantities[item.id] ?? 0}
                  onChange={(e) => {
                    const value = Math.max(0, Math.min(refundable, Math.floor(Number(e.target.value) || 0)));
                    setQuantities((prev) => ({ ...prev, [item.id]: value }));
                  }}
                />
              </div>
            );
          })}
        </div>

        <label className="field">
          <span className="field-label">Reason (optional)</span>
          <input
            className="input"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Too small, arrived damaged…"
          />
        </label>

        {error && <ErrorAlert message={error} />}

        <div className="summary-row total">
          <span>Customer gets back</span>
          <strong>{formatMoney(preview?.total ?? 0)}</strong>
        </div>

        {confirming ? (
          <div className="refund-confirm">
            <p>
              Refund {formatMoney(preview?.total ?? 0)} and return the units to stock? This can't be undone.
            </p>
            <div className="refund-actions">
              <Button variant="primary" onClick={confirm} disabled={submitting}>
                {submitting ? 'Refunding…' : 'Confirm refund'}
              </Button>
              <Button onClick={() => setConfirming(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" icon={Undo2} disabled={!preview} onClick={() => setConfirming(true)}>
            Review refund
          </Button>
        )}
      </div>
    </Card>
  );
}
