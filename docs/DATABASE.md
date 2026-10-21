# Samtech Helper POS - Database & Schema

## Tenancy & Data Isolation Model
All primary entities (`products`, `sales`, `inventory_movements`, `customers`, `expenses`, `branches`, `registers`) enforce foreign keys to `tenants(id)`.

## Primary Tables
- `profiles`: Authenticated users linked to Supabase Auth UUID. Role can be `super_admin`, `shop_owner`, or `cashier`.
- `tenants`: Supermarkets/shops. Tracks subscription status, currency (defaults to GHS), tax number.
- `branches`: Physical branch locations (e.g. Accra Mall, Tema Store, Kumasi Plaza).
- `registers`: Cashier checkout points/tills.
- `products`: Retail stock items with barcodes, cost prices, selling prices, and stock counts.
- `inventory_movements`: Immutable stock movement ledger for all deductions, restocks, and audits.
- `sales` & `sale_items`: Immutable sale transactions and itemized baskets.
- `cash_register_shifts`: Till float tracking, opening cash, closing cash, and reconciliation.
- `payments`: Transaction records (Cash, Mobile Money, Card, Split).
