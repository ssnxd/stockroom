# Partial refunds: decisions

Issue #1. Every decision below was a gap in the issue; each says what I chose and why.

## Money and rules

- **The customer gets back what they paid for the units.** The order discount is a percentage of the whole order, so it is spread across lines in proportion to line value (largest remainder, ties to the lowest line id) and a line's paid amount is its total minus its share. Without this, a refund on a discounted order would return more than was paid.
  Example: an order of a $40 item and a $60 item with a 10% code ($10 off $100). The $40 item carries 40% of the discount ($4) and refunds $36; the $60 item carries 60% ($6) and refunds $54. The two refunds add up to the $90 the customer paid.
- **Rounding.** All amounts are integer cents. The refund for a line is `cumulative(refunded + n) - cumulative(refunded)`, where `cumulative(r)` is the rounded share and the last unit returns the exact remainder. So 3 units paid $10.00 refund $3.33, $3.34, $3.33, and refunds on an order never add up to more (or less) than it paid, however they are split into requests.
- **Only `paid` orders can be refunded**, up to units bought minus units already refunded, across any number of refunds. Duplicate lines in one request, lines from other orders, zero or fractional quantities and empty requests are rejected. A request worth $0 (a 100%-discount order) is rejected rather than recorded as a refund of nothing.
- **Concurrency.** The order row is locked (`SELECT … FOR UPDATE`) while a refund is checked and written, so two staff refunding the last unit cannot both succeed. A test fires six at once.
- **Restock** happens in the same transaction as the refund; either both happen or neither.
- **Order state is derived**, not stored: refunded units against bought units gives `paid`, `partially_refunded` or `refunded`. The `status` column stays `paid | cancelled`, so the state cannot drift from the refund rows.
- **Preview endpoint.** The order page shows the amount before confirming by asking the server, which uses the same calculation as the real refund, so the number staff confirm is the number refunded.
- **No money moves.** There is no payment-provider call. A refund here records what support already did or is about to do there.

## Dashboard

- **Revenue is net of refunds, and a refund counts on the day it was issued**, not on the day of the original order. Refunds do not rewrite the day of the sale, and the chart matches the money that left on each day (the one exception: cancelling an order later removes its refunds from the figures too). The cost is that a day can show negative revenue.
- **Refunds of orders that were later cancelled are ignored**, because cancelling already removes the whole order from revenue; subtracting the refund again would double count.
- **KPI: refund rate** (refunds issued in the range as a percentage of gross revenue in the range), with the dollar amount and count underneath. A rate tells an owner whether returns are a problem at a glance and stays comparable across the 7, 30 and 90 day ranges; the amount alone does not. A refund of an older order counts in the range it was issued but its sale is outside the range, so the rate can exceed 100% on a quiet week. With no gross revenue the card shows "—".
- **Chart:** net revenue stays the area line; refunds are red bars below the zero line, so a refund-heavy day is visible without hiding the sales. The tooltip shows gross, refunds and net.
- **Average order value** is net revenue divided by orders. **Orders** is unchanged: a refunded order was still an order.
- **Top products** are net of refunded units and money in the range, taken before choosing the top five.

## Next, with more time

- Call the payment provider's refund API from here (with an idempotency key) instead of recording refunds that happened elsewhere, and store the provider's refund id.
- Record who issued the refund (needs auth) and add a permission for it.
- Distinguish returned-to-stock from damaged or written-off units; today every refunded unit goes back on the shelf.
- Refund shipping and fees once they exist, and a "refund a custom amount" path for goodwill gestures.
- UI tests for the order page. The web app has no test setup, so the refund panel is covered only by typecheck, build and manual use.
- A dashboard switch between "refunds on the day issued" and "refunds on the order's day".

## Other problems noticed

- `GET /api/orders` returns only the 50 most recent orders and has no paging or search, so support cannot find an older order to refund from the UI.
- The dashboard's daily revenue, refunds and top-products numbers come from separate queries without a shared snapshot, so a sale or refund landing between them can make them disagree briefly.
