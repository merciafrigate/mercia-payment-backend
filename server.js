// ============================================================
//  Mercia Chapter Payment Backend — server.js
//  Node.js + Express + Stripe + Resend (email)
// ============================================================

const express = require('express');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/webhook', express.raw({ type: 'application/json' }));

// ── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Mercia Chapter Payment Server running ✓' });
});

// ── Send confirmation email via Resend ────────────────────────
async function sendConfirmationEmail({ deckName, email, purpose, amount, reference }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.log('No RESEND_API_KEY set — skipping email');
    return;
  }

  const purposeLabels = {
    dues: 'Monthly Dues', levy: 'Chapter Levy', fine: 'Sanction / Fine',
    event: 'Event Contribution', welfare: 'Welfare Fund', other: 'Other'
  };

  const purposeLabel    = purposeLabels[purpose] || purpose;
  const amountFormatted = '£' + parseFloat(amount).toFixed(2);
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#08090d;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:28px;margin-bottom:10px;">⚓</div>
    <div style="font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#d4af58;margin-bottom:5px;">Buccaneers Confraternity</div>
    <div style="font-size:22px;font-weight:800;color:#f0ece4;">Mercia Chapter</div>
  </div>
  <div style="background:#0f1117;border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:28px 24px;margin-bottom:24px;">
    <div style="text-align:center;margin-bottom:22px;">
      <div style="font-size:36px;margin-bottom:10px;">✅</div>
      <div style="font-size:20px;font-weight:800;color:#f0ece4;margin-bottom:4px;">Payment Confirmed</div>
      <div style="font-size:15px;color:#f0ece4;font-weight:400;line-height:1.8;margin-top:8px;">
        Dear Alora &ldquo;${deckName}&rdquo;,<br><br>
        Thank you my rugged brother for paying the <strong style="color:#d4af58;">${purposeLabel}</strong>.<br><br>
        <span style="font-size:16px;font-weight:700;color:#d4af58;">Awumen for you.</span>
      </div>
      <div style="font-size:13px;color:#8a8880;margin-top:14px;">From Mercia p04</div>
    </div>
    <div style="background:#161820;border-radius:99px;padding:10px 18px;text-align:center;margin-bottom:22px;">
      <span style="font-size:10px;color:#8a8880;letter-spacing:1.5px;text-transform:uppercase;margin-right:8px;">REF</span>
      <span style="font-size:14px;color:#d4af58;font-weight:700;letter-spacing:1px;">${reference}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid rgba(255,255,255,0.07);">
        <td style="padding:11px 0;font-size:12px;color:#8a8880;">Deck Name</td>
        <td style="padding:11px 0;font-size:14px;color:#f0ece4;font-weight:500;text-align:right;">${deckName}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.07);">
        <td style="padding:11px 0;font-size:12px;color:#8a8880;">Purpose</td>
        <td style="padding:11px 0;font-size:14px;color:#f0ece4;font-weight:500;text-align:right;">${purposeLabel}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.07);">
        <td style="padding:11px 0;font-size:12px;color:#8a8880;">Date</td>
        <td style="padding:11px 0;font-size:14px;color:#f0ece4;font-weight:500;text-align:right;">${date}</td>
      </tr>
      <tr style="background:rgba(212,175,88,0.05);">
        <td style="padding:13px 0;font-size:12px;color:#d4af58;font-weight:600;">Amount Paid</td>
        <td style="padding:13px 0;font-size:22px;color:#f0d080;font-weight:800;text-align:right;">${amountFormatted}</td>
      </tr>
    </table>
  </div>
  <div style="text-align:center;">
    <p style="font-size:11px;color:#555350;line-height:1.8;">
      This is your official payment receipt from<br>
      Buccaneers Confraternity Mercia Chapter.<br>
      Please keep this email for your records.<br><br>
      Secured by Stripe · PCI DSS Level 1 · 256-bit SSL
    </p>
  </div>
</div>
</body></html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from:    'Mercia Chapter <payments@resend.dev>',
        to:      [email],
        subject: `✓ Payment Confirmed — ${amountFormatted} | Ref: ${reference}`,
        html:    html
      })
    });

    const result = await response.json();
    if (result.id) {
      console.log(`Email sent to ${email} — ID: ${result.id}`);
    } else {
      console.error('Email failed:', JSON.stringify(result));
    }
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

// ── Create Payment Intent ─────────────────────────────────────
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, purpose, memberName, memberEmail } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const amountInPence = Math.round(parseFloat(amount) * 100);

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

// ── Confirm & Send Email ──────────────────────────────────────
app.post('/confirm-payment', async (req, res) => {
  try {
    const { memberName, memberEmail, purpose, amount, reference } = req.body;
    await sendConfirmationEmail({
      deckName: memberName,
      email:    memberEmail,
      purpose, amount, reference
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Confirm error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe Webhook ────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      console.log(`Payment confirmed — £${(pi.amount/100).toFixed(2)} — ${pi.metadata.memberName}`);
      break;
    }
    default:
      console.log(`Event: ${event.type}`);
  }
  res.json({ received: true });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n Mercia Chapter Payment Server started on port ${PORT}`);
  console.log(`   Stripe : ${process.env.STRIPE_SECRET_KEY ? 'Key loaded' : 'No key set'}`);
  console.log(`   Email  : ${process.env.RESEND_API_KEY    ? 'Resend ready' : 'No RESEND_API_KEY — emails disabled'}\n`);
});
