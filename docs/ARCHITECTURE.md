# SamTill POS - System Architecture

## Overview
SamTill POS is a production-ready, multi-tenant supermarket and retail POS SaaS tailored for Ghanaian businesses. It is built to ensure high reliability, zero data corruption at checkout, real-time analytics for owners, and multi-tenant isolation.

## Component Architecture
1. **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS
   - Responsive layouts for Desktop, Tablet, and Mobile Cashier Tills
   - Real-time updates via Supabase Realtime WebSocket subscriptions
   - Barcode Scanner integration (USB/Bluetooth HID emulation)
   - Printable Thermal Receipt Generator (58mm / 80mm)
   - Offline IndexedDB caching with synchronization queue
2. **Database & Storage**: Supabase (PostgreSQL 15+)
   - Row Level Security (RLS) on all tenant-partitioned tables
   - Supabase Realtime publications on `sales`, `products`, `inventory_movements`, `cash_register_shifts`
   - Supabase Storage buckets for product images and shop receipts
3. **Backend & API**: Node.js + Express + TypeScript
   - Modular REST API under `/api/v1`
   - Server-authoritative checkout validation to prevent client-side price tampering
   - Webhook processing for Paystack and Mobile Money providers
