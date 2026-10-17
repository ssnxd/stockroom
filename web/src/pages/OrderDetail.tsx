import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { RefundPanel } from '../components/RefundPanel';
import { Card, CardHeader, ErrorAlert, Skeleton, StatusBadge } from '../components/ui';
import { formatDateTime, formatMoney } from '../format';
import { useApi } from '../useApi';

export function OrderDetailPage() {
  const id = Number(useParams().id);
  const location = useLocation();
  const justCreated = (location.state as { created?: boolean } | null)?.created;
  const [version, setVersion] = useState(0);
  const [justRefunded, setJustRefunded] = useState(false);
  const state = useApi((signal) => api.order(id, signal), [id, version]);
  const order = state.data;
  const refundedTotal = order?.refunds.reduce((sum, r) => sum + Math.round(r.amount * 100), 0) ?? 0;

  return (
    <div className="page">
      <div>
        <Link to="/orders" className="back-link">
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
          Orders
        </Link>
        <header className="page-header">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Order #{id}
              {order && <StatusBadge status={order.status} />}
            </h1>
            <p className="page-description">{order ? formatDateTime(order.createdAt) : ' '}</p>
          </div>
        </header>
      </div>

      {justCreated && (
        <div className="alert alert-success" role="status">
          <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />
          <span>Order created.</span>
        </div>
      )}
      {justRefunded && (
        <div className="alert alert-success" role="status">
          <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />
          <span>Refund recorded.</span>
        </div>
      )}
      {state.status === 'error' && <ErrorAlert message={state.error.message} />}

      <div className="detail-grid">
        <Card>
          <CardHeader title="Items" />
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="align-right">Unit price</th>
                  <th className="align-right">Qty</th>
                  <th className="align-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {!order && (
                  <tr>
                    <td colSpan={4}>
                      <Skeleton height={16} />
                    </td>
                  </tr>
                )}
                {order?.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="cell-primary">{item.name}</div>
                      <div className="cell-secondary">{item.sku}</div>
                    </td>
                    <td className="align-right num">{formatMoney(item.unitPrice)}</td>
                    <td className="align-right num">
                      {item.quantity}
                      {item.refundedQuantity > 0 && (
                        <div className="cell-secondary">{item.refundedQuantity} refunded</div>
                      )}
                    </td>
                    <td className="align-right num cell-primary">{formatMoney(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHeader title="Summary" />
            <div className="card-body">
              {order ? (
                <div className="summary-list">
                  <div className="summary-row">
                    <span>Subtotal</span>
                    <strong>{formatMoney(order.subtotal)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Discount{order.discountCode ? ` (${order.discountCode})` : ''}</span>
                    <strong>{order.discountAmount ? `-${formatMoney(order.discountAmount)}` : formatMoney(0)}</strong>
                  </div>
                  <div className="summary-row total">
                    <span>Total</span>
                    <strong>{formatMoney(order.total)}</strong>
                  </div>
                  {refundedTotal > 0 && (
                    <>
                      <div className="summary-row">
                        <span>Refunded</span>
                        <strong>-{formatMoney(refundedTotal / 100)}</strong>
                      </div>
                      <div className="summary-row total">
                        <span>Net</span>
                        <strong>{formatMoney(order.total - refundedTotal / 100)}</strong>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <Skeleton height={80} />
              )}
            </div>
          </Card>
          {order && (order.status === 'paid' || order.status === 'partially_refunded') && (
            <RefundPanel
              order={order}
              onRefunded={() => {
                setJustRefunded(true);
                setVersion((v) => v + 1);
              }}
            />
          )}
          {order && order.refunds.length > 0 && (
            <Card>
              <CardHeader title="Refund history" />
              <div className="card-body refund-history">
                {order.refunds.map((refund) => (
                  <div key={refund.id} className="refund-history-item">
                    <div className="summary-row">
                      <span>{formatDateTime(refund.createdAt)}</span>
                      <strong>{formatMoney(refund.amount)}</strong>
                    </div>
                    <div className="cell-secondary">
                      {refund.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
                    </div>
                    {refund.reason && <div className="cell-secondary">“{refund.reason}”</div>}
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Customer" />
            <div className="card-body">
              <dl className="meta-list">
                <div>
                  <dt>Email</dt>
                  <dd>{order?.customerEmail ?? <Skeleton width="70%" />}</dd>
                </div>
              </dl>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
