import {
  calcInvoiceTotals,
  formatDateValue,
  numberOrZero,
} from '@/lib/invoiceUtils';

const GREENPASS_LOGO_URL =
  'https://firebasestorage.googleapis.com/v0/b/greenpass-dc92d.firebasestorage.app/o/rawdatas%2FGreenPass%20Official.png?alt=media&token=809da08b-22f6-4049-bbbf-9b82342630e8';

const BLUE = '#3476c5';
const LIGHT_BLUE = '#c7e5f6';
const SKY_BLUE = '#55b8e8';
const TEXT = '#252525';

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

function plainLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildPaymentInstructions(bank = {}, businessName = 'GREENPASS IMMIGRATION') {
  const accountName = bank?.beneficiary_name || businessName || 'GREENPASS IMMIGRATION';
  const bankName = bank?.bank_name || 'Bank of Montreal (BMO)';
  const bankAddress =
    bank?.bank_address ||
    bank?.beneficiary_address ||
    '270 Dundas Street, London, ON N6A 1H3, Canada';
  const institutionNumber = bank?.institution_number || '001';
  const branchNumber = bank?.branch_transit || bank?.transit_number || '03482';
  const accountNumber = bank?.account_number || '1982597';
  const swift = bank?.swift_bic || 'BOFMCAM2';

  return [
    'For bank transfer, please use the following information:',
    `Account Name: ${accountName}`,
    `Bank Name: ${bankName}`,
    `Bank Address: ${bankAddress}`,
    `Institution Number: ${institutionNumber} Branch Number: ${branchNumber} Account Number: ${accountNumber}`,
    `SWIFT CODE: ${swift}`,
  ].join('\n');
}

function formatInvoiceMoney(value) {
  const amount = numberOrZero(value);

  try {
    const formatted = new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);

    return `$${formatted}`;
  } catch {
    return `$${amount}`;
  }
}

function getInvoiceViewData(invoice = {}) {
  const currency = invoice.currency || 'CAD';

  const totals = calcInvoiceTotals(
    invoice.items || [],
    invoice.taxAmount,
    invoice.amountPaid
  );

  const sender = invoice.sender || {};
  const bank = invoice.bankAccountSnapshot || {};

  const businessName =
    sender.legalBusinessName ||
    bank?.beneficiary_name ||
    'GREENPASS IMMIGRATION';

  const businessNumber =
    sender.businessNumber ||
    invoice.businessNumber ||
    '767696966TZ0001';

  const website =
    sender.website ||
    invoice.website ||
    'GREENPASSGROUP.COM';

  const senderPhone =
    sender.phone ||
    invoice.senderPhone ||
    '+1(437)433-3753';

  const senderEmail =
    sender.email ||
    invoice.senderEmail ||
    'finance@greenpassgroup.com';

  const senderAddress =
    sender.address ||
    invoice.senderAddress ||
    '1 Grosvenor St, London,\nOntario, Canada, N6A 1Y2';

  const invoiceNumber = invoice.invoiceNumber || 'GP-00000';
  const issueDate = formatDateValue(invoice.issueDate) || '—';
  const customerName = invoice.customerName || '—';

  const safeItems =
    Array.isArray(invoice.items) && invoice.items.length
      ? invoice.items
      : [{ description: 'Service Fee', quantity: 1, unitPrice: 0 }];

  const terms = Array.isArray(invoice.terms)
    ? invoice.terms.filter(Boolean)
    : [];

  const termsText = terms.length
    ? terms.map((term) => String(term || '').trim()).filter(Boolean).join(' ')
    : 'No guarantee of visa. Payments are non-refundable unless stated. Services depend on complete and accurate client information. GreenPass is not responsible for government or third-party decisions.';

  const paymentText =
    invoice?.paymentInstructions ||
    bank?.instructions ||
    buildPaymentInstructions(bank, businessName);

  return {
    currency,
    totals,
    sender,
    bank,
    businessName,
    businessNumber,
    website,
    senderPhone,
    senderEmail,
    senderAddress,
    invoiceNumber,
    issueDate,
    customerName,
    safeItems,
    termsText,
    paymentText,
  };
}

function renderPrintItemRows(items = []) {
  return items
    .map((item, index) => {
      const qty = numberOrZero(item.quantity);
      const unitPrice = numberOrZero(item.unitPrice);
      const lineTotal = qty * unitPrice;

      return `
        <tr class="${index % 2 === 1 ? 'alt-row' : ''}">
          <td class="item-no">${index + 1}</td>
          <td class="item-description">${block(item.description || '—')}</td>
          <td class="item-qty">${qty || ''}</td>
          <td class="item-money">${esc(formatInvoiceMoney(unitPrice))}</td>
          <td class="item-money">${esc(formatInvoiceMoney(lineTotal))}</td>
        </tr>
      `;
    })
    .join('');
}

function renderEmailItemRows(items = []) {
  return items
    .map((item, index) => {
      const qty = numberOrZero(item.quantity);
      const unitPrice = numberOrZero(item.unitPrice);
      const lineTotal = qty * unitPrice;

      return `
        <tr style="background:${index % 2 === 1 ? LIGHT_BLUE : '#ffffff'};">
          <td style="padding:8px 10px; text-align:center; border:0;">${index + 1}</td>
          <td style="padding:8px 10px; border:0;">${block(item.description || '—')}</td>
          <td style="padding:8px 10px; text-align:center; border:0;">${qty || ''}</td>
          <td style="padding:8px 10px; text-align:right; border:0;">${esc(formatInvoiceMoney(unitPrice))}</td>
          <td style="padding:8px 10px; text-align:right; border:0;">${esc(formatInvoiceMoney(lineTotal))}</td>
        </tr>
      `;
    })
    .join('');
}

export function renderInvoiceHtml(invoice = {}) {
  const {
    currency,
    totals,
    businessNumber,
    website,
    senderPhone,
    senderEmail,
    senderAddress,
    invoiceNumber,
    issueDate,
    customerName,
    safeItems,
    termsText,
    paymentText,
  } = getInvoiceViewData(invoice);

  const itemRows = renderPrintItemRows(safeItems);
  const paymentHtml = plainLines(paymentText)
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');

  const showBalance = numberOrZero(totals.paid) > 0;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${esc(invoiceNumber)}</title>
    <style>
      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #f3f6fb;
        color: ${TEXT};
        font-family: Inter, Arial, Helvetica, sans-serif;
      }

      .page {
        width: 900px;
        min-width: 900px;
        min-height: 1160px;
        margin: 24px auto;
        background: #ffffff;
        padding: 58px 60px 44px;
        color: ${TEXT};
      }

      .top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 32px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .brand-logo {
        width: 58px;
        height: 58px;
        object-fit: contain;
        display: block;
      }

      .brand-title {
        font-size: 27px;
        font-weight: 900;
        line-height: 1;
        letter-spacing: -0.02em;
      }

      .brand-subtitle {
        margin-top: 6px;
        font-size: 16px;
        letter-spacing: 0.03em;
      }

      .invoice-title {
        color: ${BLUE};
        font-size: 50px;
        font-weight: 900;
        letter-spacing: 0.13em;
        line-height: 1;
        text-align: right;
      }

      .header-line {
        margin-top: 28px;
        display: flex;
        align-items: center;
      }

      .header-line-cap {
        width: 72px;
        height: 6px;
        background: ${SKY_BLUE};
        border-radius: 999px;
      }

      .header-line-main {
        height: 3px;
        background: ${BLUE};
        flex: 1;
      }

      .website {
        padding-left: 8px;
        font-size: 16px;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }

      .business-number {
        margin-top: 24px;
        font-size: 18px;
        line-height: 1.45;
      }

      .invoice-info {
        margin-top: 82px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 32px;
      }

      .invoice-to-label {
        font-size: 18px;
      }

      .customer-name {
        margin-top: 28px;
        font-size: 27px;
        font-weight: 900;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .invoice-meta {
        text-align: right;
        padding-top: 8px;
      }

      .invoice-number {
        font-size: 20px;
        font-weight: 800;
      }

      .invoice-date {
        margin-top: 32px;
        font-size: 20px;
      }

      .items-box {
        margin-top: 64px;
        border: 5px solid ${BLUE};
        min-height: 260px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      thead tr {
        background: ${BLUE};
        color: #ffffff;
      }

      th {
        padding: 8px 8px;
        font-size: 16px;
        font-weight: 900;
        text-align: left;
      }

      th.item-no-head {
        width: 60px;
      }

      th.item-qty-head {
        width: 100px;
        text-align: center;
      }

      th.item-price-head,
      th.item-total-head {
        width: 150px;
        text-align: right;
      }

      td {
        padding: 8px 8px;
        font-size: 16px;
        vertical-align: top;
      }

      tr.alt-row {
        background: ${LIGHT_BLUE};
      }

      .item-no {
        text-align: center;
        padding-left: 16px;
        padding-right: 16px;
      }

      .item-description {
        text-align: left;
      }

      .item-qty {
        text-align: center;
      }

      .item-money {
        text-align: right;
      }

      .total-wrap {
        margin-top: 30px;
        display: flex;
        justify-content: flex-end;
      }

      .total-box {
        width: 430px;
      }

      .total-main {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        background: ${BLUE};
        color: #ffffff;
        font-size: 18px;
        font-weight: 900;
      }

      .total-label {
        padding: 9px 20px;
        text-align: right;
      }

      .total-value {
        min-width: 130px;
        padding: 9px 12px;
        text-align: right;
      }

      .balance-lines {
        margin-top: 8px;
        font-size: 14px;
        text-align: right;
      }

      .balance-lines strong {
        font-weight: 800;
      }

      .payment-section {
        margin-top: 18px;
      }

      .section-label {
        display: inline-block;
        background: ${BLUE};
        color: #ffffff;
        font-size: 17px;
        font-weight: 900;
        letter-spacing: 0.04em;
        padding: 8px 14px;
      }

      .payment-text {
        margin-top: 14px;
        font-size: 16px;
        line-height: 1.45;
      }

      .blue-line {
        margin-top: 20px;
        width: 350px;
        height: 3px;
        background: ${BLUE};
      }

      .etransfer {
        margin-top: 14px;
        font-size: 16px;
      }

      .terms {
        margin-top: 14px;
      }

      .terms-title {
        font-size: 18px;
        font-weight: 900;
      }

      .terms-text {
        margin-top: 10px;
        font-size: 15px;
        line-height: 1.45;
        color: #5f6368;
      }

      .footer {
        margin-top: 38px;
      }

      .footer-line {
        display: flex;
        align-items: center;
      }

      .footer-line-cap {
        width: 72px;
        height: 6px;
        background: ${SKY_BLUE};
        border-radius: 999px;
      }

      .footer-line-main {
        height: 3px;
        background: ${BLUE};
        flex: 1;
      }

      .footer-grid {
        margin-top: 24px;
        display: grid;
        grid-template-columns: 1fr 1.25fr 1.35fr;
        gap: 20px;
        font-size: 16px;
      }

      .footer-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
      }

      .footer-icon {
        color: ${SKY_BLUE};
        font-size: 30px;
        line-height: 1;
        min-width: 32px;
        text-align: center;
      }

      .footer-text {
        line-height: 32px;
        word-break: break-word;
        min-width: 0;
      }

      .footer-text.multiline {
        line-height: 1.25;
        padding-top: 2px;
        word-break: break-word;
        min-width: 0;
      }

      @page {
        size: letter;
        margin: 0;
      }

      @media print {
        body {
          background: #ffffff;
        }

        .page {
          width: 900px;
          min-width: 900px;
          min-height: auto;
          margin: 0 auto;
          box-shadow: none;
          padding: 58px 60px 44px;
        }
      }
    </style>
  </head>

  <body>
    <div class="page">
      <div class="top">
        <div class="brand">
          <img class="brand-logo" src="${esc(GREENPASS_LOGO_URL)}" alt="GreenPass" />
          <div>
            <div class="brand-title">GREENPASS</div>
            <div class="brand-subtitle">STUDY ABROAD APP</div>
          </div>
        </div>

        <div class="invoice-title">INVOICE</div>
      </div>

      <div class="header-line">
        <div class="header-line-cap"></div>
        <div class="header-line-main"></div>
        <div class="website">${esc(website)}</div>
      </div>

      <div class="business-number">
        <div>Business Number</div>
        <div>${esc(businessNumber)}</div>
      </div>

      <div class="invoice-info">
        <div>
          <div class="invoice-to-label">Invoice to :</div>
          <div class="customer-name">${esc(customerName)}</div>
        </div>

        <div class="invoice-meta">
          <div class="invoice-number">Invoice no : ${esc(invoiceNumber)}</div>
          <div class="invoice-date">${esc(issueDate)}</div>
        </div>
      </div>

      <div class="items-box">
        <table>
          <thead>
            <tr>
              <th class="item-no-head">NO</th>
              <th>DESCRIPTION</th>
              <th class="item-qty-head">QTY</th>
              <th class="item-price-head">PRICE</th>
              <th class="item-total-head">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>
      </div>

      <div class="total-wrap">
        <div class="total-box">
          <div class="total-main">
            <div class="total-label">TOTAL ${esc(currency)} :</div>
            <div class="total-value">${esc(formatInvoiceMoney(totals.total))}</div>
          </div>

          ${
            showBalance
              ? `
                <div class="balance-lines">
                  <div>Amount Paid: ${esc(formatInvoiceMoney(totals.paid))}</div>
                  <div><strong>Balance Due: ${esc(formatInvoiceMoney(totals.balanceDue))}</strong></div>
                </div>
              `
              : ''
          }
        </div>
      </div>

      <div class="payment-section">
        <div class="section-label">PAYMENT METHOD :</div>

        <div class="payment-text">
          ${paymentHtml}
        </div>

        <div class="blue-line"></div>

        <div class="etransfer">
          Interac e-Transfer (Canada only) Email: ${esc(senderEmail)}
        </div>

        <div class="blue-line"></div>
      </div>

      <div class="terms">
        <div class="terms-title">Term and Conditions :</div>
        <div class="terms-text">${esc(termsText)}</div>
      </div>

      <div class="footer">
        <div class="footer-line">
          <div class="footer-line-cap"></div>
          <div class="footer-line-main"></div>
          <div class="footer-line-cap"></div>
        </div>

        <div class="footer-grid">
          <div class="footer-item">
            <div class="footer-icon">☎</div>
            <div class="footer-text">${esc(senderPhone)}</div>
          </div>

          <div class="footer-item">
            <div class="footer-icon">✉</div>
            <div class="footer-text">${esc(senderEmail)}</div>
          </div>

          <div class="footer-item">
            <div class="footer-icon">⌖</div>
            <div class="footer-text multiline">${block(senderAddress)}</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function renderInvoiceEmailHtml(invoice = {}) {
  const {
    currency,
    totals,
    businessNumber,
    website,
    senderPhone,
    senderEmail,
    senderAddress,
    invoiceNumber,
    issueDate,
    customerName,
    safeItems,
    termsText,
    paymentText,
  } = getInvoiceViewData(invoice);

  const itemRows = renderEmailItemRows(safeItems);
  const paymentHtml = plainLines(paymentText)
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${esc(invoiceNumber)}</title>
  </head>

  <body style="margin:0; padding:0; background:#ffffff; color:${TEXT}; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background:#ffffff;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="760" cellspacing="0" cellpadding="0" border="0" style="width:760px; max-width:760px; background:#ffffff; color:${TEXT}; font-family:Arial, Helvetica, sans-serif;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="left" valign="top" style="width:50%;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td valign="middle" style="padding-right:10px;">
                            <img src="${esc(GREENPASS_LOGO_URL)}" alt="GreenPass" width="58" height="58" style="display:block; width:58px; height:58px; object-fit:contain;" />
                          </td>
                          <td valign="middle">
                            <div style="font-size:27px; font-weight:900; line-height:1; letter-spacing:-0.02em; color:${TEXT};">GREENPASS</div>
                            <div style="font-size:16px; margin-top:6px; letter-spacing:0.03em; color:${TEXT};">STUDY ABROAD APP</div>
                          </td>
                        </tr>
                      </table>
                    </td>

                    <td align="right" valign="top" style="width:50%;">
                      <div style="color:${BLUE}; font-size:50px; font-weight:900; letter-spacing:0.13em; line-height:1;">INVOICE</div>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;">
                  <tr>
                    <td style="width:72px;">
                      <div style="height:6px; background:${SKY_BLUE}; border-radius:999px; line-height:6px;">&nbsp;</div>
                    </td>
                    <td>
                      <div style="height:3px; background:${BLUE}; line-height:3px;">&nbsp;</div>
                    </td>
                    <td style="width:190px; padding-left:8px; white-space:nowrap; font-size:16px; letter-spacing:0.03em; color:${TEXT};">
                      ${esc(website)}
                    </td>
                  </tr>
                </table>

                <div style="margin-top:24px; font-size:18px; line-height:1.45; color:${TEXT};">
                  <div>Business Number</div>
                  <div>${esc(businessNumber)}</div>
                </div>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:82px;">
                  <tr>
                    <td valign="top" align="left" style="width:50%;">
                      <div style="font-size:18px;">Invoice to :</div>
                      <div style="margin-top:28px; font-size:27px; font-weight:900; letter-spacing:0.04em; text-transform:uppercase;">
                        ${esc(customerName)}
                      </div>
                    </td>

                    <td valign="top" align="right" style="width:50%; padding-top:8px;">
                      <div style="font-size:20px; font-weight:800;">Invoice no : ${esc(invoiceNumber)}</div>
                      <div style="margin-top:32px; font-size:20px;">${esc(issueDate)}</div>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:64px; border:5px solid ${BLUE}; min-height:260px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse; width:100%; font-size:16px;">
                    <thead>
                      <tr style="background:${BLUE}; color:#ffffff;">
                        <th align="left" style="padding:8px 10px; width:60px; font-size:16px; font-weight:900;">NO</th>
                        <th align="left" style="padding:8px 10px; font-size:16px; font-weight:900;">DESCRIPTION</th>
                        <th align="center" style="padding:8px 10px; width:100px; font-size:16px; font-weight:900;">QTY</th>
                        <th align="right" style="padding:8px 10px; width:150px; font-size:16px; font-weight:900;">PRICE</th>
                        <th align="right" style="padding:8px 10px; width:150px; font-size:16px; font-weight:900;">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemRows}
                    </tbody>
                  </table>
                </div>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:30px;">
                  <tr>
                    <td align="right">
                      <table role="presentation" width="430" cellspacing="0" cellpadding="0" border="0" style="width:430px; background:${BLUE}; color:#ffffff;">
                        <tr>
                          <td align="right" style="padding:9px 20px; font-size:18px; font-weight:900;">
                            TOTAL ${esc(currency)} :
                          </td>
                          <td align="right" style="padding:9px 12px; min-width:130px; font-size:18px; font-weight:900;">
                            ${esc(formatInvoiceMoney(totals.total))}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:18px;">
                  <div style="display:inline-block; background:${BLUE}; color:#ffffff; font-size:17px; font-weight:900; letter-spacing:0.04em; padding:8px 14px;">
                    PAYMENT METHOD :
                  </div>

                  <div style="margin-top:14px; font-size:16px; line-height:1.45; color:${TEXT};">
                    ${paymentHtml}
                  </div>

                  <div style="margin-top:20px; width:350px; height:3px; background:${BLUE}; line-height:3px;">&nbsp;</div>

                  <div style="margin-top:14px; font-size:16px; color:${TEXT};">
                    Interac e-Transfer (Canada only) Email: ${esc(senderEmail)}
                  </div>

                  <div style="margin-top:20px; width:350px; height:3px; background:${BLUE}; line-height:3px;">&nbsp;</div>
                </div>

                <div style="margin-top:14px;">
                  <div style="font-size:18px; font-weight:900; color:${TEXT};">Term and Conditions :</div>
                  <div style="margin-top:10px; font-size:15px; line-height:1.45; color:#5f6368;">
                    ${esc(termsText)}
                  </div>
                </div>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:38px;">
                  <tr>
                    <td style="width:72px;">
                      <div style="height:6px; background:${SKY_BLUE}; border-radius:999px; line-height:6px;">&nbsp;</div>
                    </td>
                    <td>
                      <div style="height:3px; background:${BLUE}; line-height:3px;">&nbsp;</div>
                    </td>
                    <td style="width:72px;">
                      <div style="height:6px; background:${SKY_BLUE}; border-radius:999px; line-height:6px;">&nbsp;</div>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px; font-size:16px; color:${TEXT};">
                  <tr>
                    <td valign="top" style="width:33%; padding-right:12px;">
                      <span style="color:${SKY_BLUE}; font-size:28px;">☎</span>
                      <span>${esc(senderPhone)}</span>
                    </td>
                    <td valign="top" style="width:34%; padding-right:12px;">
                      <span style="color:${SKY_BLUE}; font-size:28px;">✉</span>
                      <span>${esc(senderEmail)}</span>
                    </td>
                    <td valign="top" style="width:33%;">
                      <span style="color:${SKY_BLUE}; font-size:28px;">⌖</span>
                      <span>${block(senderAddress)}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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