import { AlertTriangle, BarChart3, DollarSign, ReceiptText, ShoppingBag, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RevenueChart } from '../components/RevenueChart';
import { TopProductsChart } from '../components/TopProductsChart';
import { Card, CardHeader, EmptyState, ErrorAlert, PageHeader, Segmented, Skeleton } from '../components/ui';
import { formatMoney, formatNumber, formatPercent } from '../format';
import { useApi } from '../useApi';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

function Kpi({ label, icon, value, hint }: { label: string; icon: ReactNode; value?: string; hint?: ReactNode }) {
  return (
    <Card className="kpi">
      <span className="kpi-label">
        {icon}
        {label}
      </span>
      {value === undefined ? <Skeleton width="60%" height={30} /> : <span className="kpi-value fade-in">{value}</span>}
      {hint && <span className="kpi-hint">{hint}</span>}
    </Card>
  );
}

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const state = useApi((signal) => api.dashboard(days, signal), [days]);
  const data = state.data;
  const iconProps = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description="How the store is doing, based on paid orders."
        action={<Segmented label="Date range" options={RANGES} value={days} onChange={setDays} />}
      />

      {state.status === 'error' && <ErrorAlert message={state.error.message} />}

      <div className="kpi-grid">
        <Kpi
          label="Revenue"
          icon={<DollarSign {...iconProps} />}
          value={data && formatMoney(data.kpis.revenue)}
          hint={`Net of refunds, last ${days} days`}
        />
        <Kpi
          label="Orders"
          icon={<ReceiptText {...iconProps} />}
          value={data && formatNumber(data.kpis.orders)}
          hint="Excludes cancelled"
        />
        <Kpi
          label="Avg. order value"
          icon={<ShoppingBag {...iconProps} />}
          value={data && formatMoney(data.kpis.averageOrderValue)}
          hint="Revenue per order"
        />
        <Kpi
          label="Refund rate"
          icon={<Undo2 {...iconProps} />}
          value={data && (data.kpis.refundRate === null ? '—' : formatPercent(data.kpis.refundRate))}
          hint={
            data &&
            `${formatMoney(data.kpis.refunds)} refunded in ${formatNumber(data.kpis.refundCount)} ${
              data.kpis.refundCount === 1 ? 'refund' : 'refunds'
            }`
          }
        />
        <Kpi
          label="Low stock"
          icon={<AlertTriangle {...iconProps} />}
          value={data && formatNumber(data.kpis.lowStockProducts)}
          hint={<Link to="/products">Products with 5 or fewer left</Link>}
        />
      </div>

      <div className="chart-grid">
        <Card>
          <CardHeader title="Revenue" subtitle="Daily revenue net of refunds, refunds below the line" />
          <div className="card-body">
            {!data ? (
              <Skeleton height={280} />
            ) : data.kpis.orders === 0 && data.kpis.refundCount === 0 ? (
              <EmptyState icon={BarChart3} title="No orders yet" description="Revenue will show up here." />
            ) : (
              <RevenueChart data={data.revenueByDay} />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Top products" subtitle="By revenue" />
          <div className="card-body">
            {!data ? (
              <Skeleton height={280} />
            ) : data.topProducts.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="No sales yet" />
            ) : (
              <TopProductsChart data={data.topProducts} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
