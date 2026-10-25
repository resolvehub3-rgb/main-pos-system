# SamTill POS - Ghana Payment Integrations

## Supported Payment Rails
1. **Cash**: Immediate cashier register handling with cash tendered and change calculation.
2. **Mobile Money (MTN MoMo, Telecel Cash, AT Money)**:
   - Cashiers can record verified USSD reference numbers directly.
   - For automated collection, backend triggers Paystack Charge API with phone number and provider network.
3. **Card (Visa, Mastercard, Gh-Link)**:
   - Physical POS terminal reference or Paystack Terminal integration.
4. **Split Payments**:
   - Allows combination (e.g. GH₵ 50.00 Cash + GH₵ 8.00 Mobile Money). Validated server-side to equal total due.

## Production Credentials Needed
- `PAYSTACK_SECRET_KEY`: Merchant secret from dashboard.paystack.com
- `PAYSTACK_PUBLIC_KEY`: For direct client-side tokenization if needed
- Webhook URL registered at: `https://<backend-domain>/api/v1/payments/paystack/webhook`
