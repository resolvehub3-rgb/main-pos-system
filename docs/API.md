# SamTill POS - API & Integration Endpoints

All endpoints are versioned under `/api/v1`.

### Endpoints
- `POST /api/v1/sales/checkout`: Authoritative server checkout with stock decrement and idempotency.
- `GET /api/v1/products`: List tenant products with search by name or barcode.
- `POST /api/v1/products`: Create new product and barcode entry.
- `POST /api/v1/shifts/open`: Open cashier shift with initial cash float.
- `POST /api/v1/shifts/close`: Close shift with actual cash count and variance report.
- `POST /api/v1/payments/paystack/initialize`: Initialize Paystack Mobile Money/Card payment.
- `POST /api/v1/payments/paystack/webhook`: Cryptographically verified webhook for MoMo/card confirmation.
- `GET /api/v1/reports/dashboard`: Summary KPIs (Net Sales, Gross Profit, Orders, Low Stock).
- `GET /api/v1/health`: Service health check for container probes.
