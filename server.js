// ============================================================
//  Mercia Chapter Payment Backend — server.js
//  Node.js + Express + Stripe
// ============================================================

const express = require('express');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Raw body needed for Stripe webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));

// ── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Mercia Chapter Payment Server running ✓' });
});

// ── Create Payment Intent ─────────────────────────────────────
// Called by the frontend before charging the card
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, purpose, memberName, memberEmail } = req.body;

    // Validate amount (must be positive, in pounds)
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const amountInPence = Math.round(parseFloat(amount) * 100); // Stripe uses pence

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountInPence,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      description: `Mercia Chapter — ${purpose}`,
      receipt_email: memberEmail || undefined,
      metadata: {
        memberName:  memberName  || '',
        memberEmail: memberEmail || '',
        purpose:     purpose     || '',
        chapter:     'Mercia'
      }
    });

    res.json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('PaymentIntent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe Webhook (optional but recommended) ─────────────────
// Listens for payment confirmation events from Stripe
app.post('/webhook', (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      console.log(`✅ Payment confirmed — £${(pi.amount / 100).toFixed(2)} — ${pi.metadata.memberName} — ${pi.metadata.purpose}`);
      // TODO: send confirmation email, log to database, etc.
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      console.log(`❌ Payment failed — ${pi.metadata.memberName}`);
      break;
    }
    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  res.json({ received: true });
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Mercia Chapter Payment Server started`);
  console.log(`   Port    : ${PORT}`);
  console.log(`   Stripe  : ${process.env.STRIPE_SECRET_KEY ? '✓ Key loaded' : '⚠ No key — set STRIPE_SECRET_KEY'}`);
  console.log(`   Webhook : ${process.env.STRIPE_WEBHOOK_SECRET ? '✓ Secret loaded' : '(optional) set STRIPE_WEBHOOK_SECRET'}\n`);
});
