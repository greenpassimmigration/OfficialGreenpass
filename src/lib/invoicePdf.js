import { calcInvoiceTotals, formatCurrency, formatDateValue, numberOrZero } from '@/lib/invoiceUtils';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function block(value) {
  return esc(value).replace(/\n/g, '<br/>');
}

export function renderInvoiceHtml(invoice = {}) {
  const currency = invoice.currency || 'CAD';
  const totals = calcInvoiceTotals(invoice.items || [], invoice.taxAmount, invoice.amountPaid);
  const sender = invoice.sender || {};
  const bank = invoice.bankAccountSnapshot || {};
  const terms = Array.isArray(invoice.terms) ? invoice.terms.filter(Boolean) : [];

  const itemRows = (invoice.items || [])
    .map((item) => {
      const qty = numberOrZero(item.quantity);
      const unitPrice = numberOrZero(item.unitPrice);
      const lineTotal = qty * unitPrice;
      return `
        <tr>
          <td>${block(item.description || '—')}</td>
          <td class="right">${esc(qty)}</td>
          <td class="right">${esc(formatCurrency(unitPrice, currency))}</td>
          <td class="right">${esc(formatCurrency(lineTotal, currency))}</td>
        </tr>`;
    })
    .join('');

  const paymentBits = [
    bank.beneficiary_name ? `<div><strong>Beneficiary:</strong> ${esc(bank.beneficiary_name)}</div>` : '',
    bank.bank_name ? `<div><strong>Bank:</strong> ${esc(bank.bank_name)}</div>` : '',
    bank.account_number ? `<div><strong>Account No.:</strong> ${esc(bank.account_number)}</div>` : '',
    bank.branch_transit ? `<div><strong>Transit:</strong> ${esc(bank.branch_transit)}</div>` : '',
    bank.institution_number ? `<div><strong>Institution:</strong> ${esc(bank.institution_number)}</div>` : '',
    bank.swift_bic ? `<div><strong>SWIFT/BIC:</strong> ${esc(bank.swift_bic)}</div>` : '',
    bank.instructions ? `<div style="margin-top:8px">${block(bank.instructions)}</div>` : '',
    invoice.paymentInstructions ? `<div style="margin-top:8px">${block(invoice.paymentInstructions)}</div>` : '',
  ].filter(Boolean).join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Invoice ${esc(invoice.invoiceNumber || '')}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Inter, Arial, sans-serif; margin: 0; background: #f5f7fb; color: #0f172a; }
        .page { width: 900px; margin: 24px auto; background: #fff; padding: 42px; }
        .top { display:flex; justify-content:space-between; gap:32px; align-items:flex-start; }
        .brand h1 { margin: 0; font-size: 34px; color: #0f8f62; letter-spacing: .04em; }
        .brand .tag { margin-top: 6px; color:#475569; font-size: 14px; }
        .muted { color:#64748b; }
        .meta { min-width: 260px; border:1px solid #e2e8f0; border-radius: 16px; overflow:hidden; }
        .meta .head { background:#0f172a; color:#fff; padding:14px 18px; font-size: 13px; letter-spacing: .08em; }
        .meta .body { padding: 16px 18px; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top: 28px; }
        .panel { border:1px solid #e2e8f0; border-radius: 16px; padding: 18px; }
        .panel h3 { margin:0 0 10px 0; font-size: 13px; letter-spacing:.08em; text-transform:uppercase; color:#475569; }
        table { width:100%; border-collapse: collapse; margin-top:28px; }
        th, td { padding:14px 12px; border-bottom:1px solid #e2e8f0; vertical-align: top; }
        th { background:#f8fafc; text-align:left; font-size: 12px; letter-spacing:.06em; text-transform:uppercase; color:#475569; }
        .right { text-align:right; }
        .totals { margin-top: 20px; margin-left:auto; width: 320px; }
        .totals .row { display:flex; justify-content:space-between; padding:8px 0; }
        .totals .grand { font-size:22px; font-weight:700; border-top:2px solid #0f172a; margin-top:8px; padding-top:14px; }
        .status { display:inline-block; padding:6px 10px; border-radius:999px; font-size:12px; background:#ecfeff; color:#155e75; text-transform:capitalize; }
        .footer-grid { display:grid; grid-template-columns: 1.2fr .8fr; gap: 28px; margin-top: 28px; }
        .terms li { margin-bottom: 8px; }
        .paybox { background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; padding:18px; }
        .small { font-size: 13px; }
        @media print {
          body { background:#fff; }
          .page { margin:0; width:auto; }
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="top">
          <div class="brand">
            <h1>INVOICE</h1>
            <div class="tag">GreenPass billing document</div>
            <div style="margin-top:18px" class="small">
              <div><strong>${esc(sender.legalBusinessName || 'GreenPass')}</strong></div>
              ${sender.businessNumber ? `<div>Business No.: ${esc(sender.businessNumber)}</div>` : ''}
              ${sender.address ? `<div>${block(sender.address)}</div>` : ''}
              ${sender.email ? `<div>${esc(sender.email)}</div>` : ''}
              ${sender.phone ? `<div>${esc(sender.phone)}</div>` : ''}
            </div>
          </div>
          <div class="meta">
            <div class="head">INVOICE DETAILS</div>
            <div class="body small">
              <div class="row"><strong>Invoice #:</strong> ${esc(invoice.invoiceNumber || '—')}</div>
              <div class="row"><strong>Issue Date:</strong> ${esc(formatDateValue(invoice.issueDate))}</div>
              <div class="row"><strong>Due Date:</strong> ${esc(formatDateValue(invoice.dueDate))}</div>
              <div class="row"><strong>Status:</strong> <span class="status">${esc(invoice.status || 'draft')}</span></div>
              <div class="row"><strong>Currency:</strong> ${esc(currency)}</div>
              ${invoice.paymentReference ? `<div class="row"><strong>Payment Ref:</strong> ${esc(invoice.paymentReference)}</div>` : ''}
            </div>
          </div>
        </div>

        <div class="grid2">
          <div class="panel small">
            <h3>Billed To</h3>
            <div><strong>${esc(invoice.customerName || '—')}</strong></div>
            ${invoice.clientId ? `<div>Client ID: ${esc(invoice.clientId)}</div>` : ''}
            ${invoice.customerAddress ? `<div>${block(invoice.customerAddress)}</div>` : ''}
            ${invoice.customerEmail ? `<div>${esc(invoice.customerEmail)}</div>` : ''}
            ${invoice.customerPhone ? `<div>${esc(invoice.customerPhone)}</div>` : ''}
          </div>
          <div class="panel small">
            <h3>Payment Notes</h3>
            <div>${block(invoice.notes || 'Please pay by the due date listed above.')}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th class="right">Qty</th>
              <th class="right">Unit Price</th>
              <th class="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="4">No line items added.</td></tr>'}
          </tbody>
        </table>

        <div class="totals">
          <div class="row"><span>Subtotal</span><strong>${esc(formatCurrency(totals.subtotal, currency))}</strong></div>
          <div class="row"><span>${esc(invoice.taxLabel || 'Tax')}</span><strong>${esc(formatCurrency(totals.taxAmount, currency))}</strong></div>
          <div class="row"><span>Amount Paid</span><strong>${esc(formatCurrency(totals.paid, currency))}</strong></div>
          <div class="row grand"><span>Balance Due</span><strong>${esc(formatCurrency(totals.balanceDue, currency))}</strong></div>
        </div>

        <div class="footer-grid">
          <div class="panel small">
            <h3>Terms</h3>
            <ul class="terms">
              ${(terms.length ? terms : ['Payment confirms agreement to the applicable service terms.'])
                .map((term) => `<li>${block(term)}</li>`)
                .join('')}
            </ul>
          </div>
          <div class="paybox small">
            <h3 style="margin-top:0">Payment Information</h3>
            ${paymentBits || '<div>Add bank or payment instructions from admin settings.</div>'}
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

export function openInvoicePrintWindow(invoice = {}) {
  const html = renderInvoiceHtml(invoice);
  const win = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=768');
  if (!win) {
    throw new Error('Popup blocked. Please allow popups to print the invoice.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
