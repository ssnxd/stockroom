export interface Product {
  id: number;
  sku: string;
  name: string;
  price: number;
  stock: number;
  createdAt: string;
}

export interface ProductPage {
  products: Product[];
  total: number;
  nextCursor: string | null;
}

export type OrderStatus = 'paid' | 'partially_refunded' | 'refunded' | 'cancelled';

export interface OrderSummary {
  id: number;
  customerEmail: string;
  status: OrderStatus;
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  total: number;
  itemCount: number;
  createdAt: string;
}

export interface OrderItem {
  id: number;
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  refundedQuantity: number;
}

export interface OrderRefund {
  id: number;
  createdAt: string;
  amount: number;
  reason: string | null;
  items: { orderItemId: number; name: string; quantity: number; amount: number }[];
}

export interface OrderDetail extends Omit<OrderSummary, 'itemCount'> {
  items: OrderItem[];
  refunds: OrderRefund[];
}

export interface RefundInput {
  items: { orderItemId: number; quantity: number }[];
  reason?: string;
}

export interface RefundPreview {
  items: { orderItemId: number; quantity: number; amount: number }[];
  total: number;
}

export interface DailyRevenue {
  day: string;
  revenue: number; // net of refunds
  grossRevenue: number;
  refunds: number;
  orders: number;
  aov: number;
}

export interface Dashboard {
  range: { days: number; since: string };
  kpis: {
    revenue: number;
    orders: number;
    averageOrderValue: number;
    lowStockProducts: number;
    refunds: number;
    refundCount: number;
    refundRate: number | null;
  };
  revenueByDay: DailyRevenue[];
  topProducts: { productId: number; name: string; units: number; revenue: number }[];
}

export interface CreateOrderInput {
  customerEmail: string;
  items: { productId: number; quantity: number }[];
  discountCode?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  dashboard: (days: number, signal?: AbortSignal) =>
    request<Dashboard>(`/api/dashboard?days=${days}`, { signal }),
  products: (params: { limit?: number; cursor?: string | null } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    return request<ProductPage>(`/api/products?${query}`, { signal });
  },
  orders: (signal?: AbortSignal) => request<{ orders: OrderSummary[] }>('/api/orders', { signal }),
  order: (id: number, signal?: AbortSignal) => request<OrderDetail>(`/api/orders/${id}`, { signal }),
  previewRefund: (orderId: number, input: RefundInput, signal?: AbortSignal) =>
    request<RefundPreview>(`/api/orders/${orderId}/refunds/preview`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  createRefund: (orderId: number, input: RefundInput) =>
    request<OrderDetail>(`/api/orders/${orderId}/refunds`, { method: 'POST', body: JSON.stringify(input) }),
  createOrder: (input: CreateOrderInput) =>
    request<OrderDetail>('/api/orders', { method: 'POST', body: JSON.stringify(input) }),
};
