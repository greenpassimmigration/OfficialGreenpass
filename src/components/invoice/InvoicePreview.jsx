import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
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

export default function InvoicePreview({ invoice }) {
  const safeInvoice = invoice || {};

  const totals = calcInvoiceTotals(
    safeInvoice?.items || [],
    safeInvoice?.taxAmount,
    safeInvoice?.amountPaid
  );

  const currency = safeInvoice?.currency || 'CAD';
  const sender = safeInvoice?.sender || {};
  const bank = safeInvoice?.bankAccountSnapshot || {};

  const businessName =
    sender.legalBusinessName ||
    bank?.beneficiary_name ||
    'GREENPASS IMMIGRATION';

  const businessNumber =
    sender.businessNumber ||
    safeInvoice?.businessNumber ||
    '767696966TZ0001';

  const website =
    sender.website ||
    safeInvoice?.website ||
    'GREENPASSGROUP.COM';

  const senderPhone =
    sender.phone ||
    safeInvoice?.senderPhone ||
    '+1(437)433-3753';

  const senderEmail =
    sender.email ||
    safeInvoice?.senderEmail ||
    'finance@greenpassgroup.com';

  const senderAddress =
    sender.address ||
    safeInvoice?.senderAddress ||
    '1 Grosvenor St, London,\nOntario, Canada, N6A 1Y2';

  const customerName = safeInvoice?.customerName || '—';
  const invoiceNumber = safeInvoice?.invoiceNumber || 'GP-00000';
  const issueDate = formatDateValue(safeInvoice?.issueDate) || '—';

  const items =
    Array.isArray(safeInvoice?.items) && safeInvoice.items.length
      ? safeInvoice.items
      : [{ description: 'Service fee', quantity: 1, unitPrice: 0 }];

  const terms = Array.isArray(safeInvoice?.terms)
    ? safeInvoice.terms.filter(Boolean)
    : [];

  const displayedTerms = terms.length
    ? terms.join(' ')
    : 'No guarantee of visa. Payments are non-refundable unless stated. Services depend on complete and accurate client information. GreenPass is not responsible for government or third-party decisions.';

  const paymentText =
    safeInvoice?.paymentInstructions ||
    bank?.instructions ||
    buildPaymentInstructions(bank, businessName);

  return (
    <Card className="rounded-3xl shadow-sm border-slate-200 overflow-hidden bg-slate-100">
      <CardContent className="p-4 md:p-8">
        <div
          className="mx-auto bg-white text-[#252525] shadow-sm"
          style={invoicePageStyle}
        >
          <Header website={website} businessNumber={businessNumber} />

          <InvoiceInfo
            customerName={customerName}
            invoiceNumber={invoiceNumber}
            issueDate={issueDate}
          />

          <ItemsTable items={items} />

          <TotalBox
            currency={currency}
            total={totals.total}
            amountPaid={totals.paid}
            balanceDue={totals.balanceDue}
          />

          <PaymentSection paymentText={paymentText} senderEmail={senderEmail} />

          <TermsSection terms={displayedTerms} />

          <Footer phone={senderPhone} email={senderEmail} address={senderAddress} />
        </div>
      </CardContent>
    </Card>
  );
}

function Header({ website, businessNumber }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-8">
        <div className="flex items-center">
          <img
            src={GREENPASS_LOGO_URL}
            alt="GreenPass Study Abroad App"
            style={{
              width: 235,
              height: 'auto',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        <div className="text-right">
          <div
            className="font-black tracking-[0.13em] leading-none"
            style={{ color: BLUE, fontSize: 50 }}
          >
            INVOICE
          </div>
        </div>
      </div>

      <div className="mt-7 flex items-center">
        <div
          style={{
            width: 72,
            height: 6,
            background: SKY_BLUE,
            borderRadius: 999,
          }}
        />
        <div
          style={{
            flex: 1,
            height: 3,
            background: BLUE,
          }}
        />
        <div className="pl-2 text-[16px] tracking-wide whitespace-nowrap">
          {website}
        </div>
      </div>

      <div className="mt-6 text-[18px] leading-7">
        <div>Business Number</div>
        <div>{businessNumber}</div>
      </div>
    </div>
  );
}

function InvoiceInfo({ customerName, invoiceNumber, issueDate }) {
  return (
    <div className="mt-20 grid grid-cols-2 gap-8">
      <div>
        <div className="text-[18px]">Invoice to :</div>
        <div className="mt-7 text-[27px] font-black tracking-wide uppercase">
          {customerName}
        </div>
      </div>

      <div className="text-right pt-2">
        <div className="text-[20px] font-extrabold">
          Invoice no : {invoiceNumber}
        </div>
        <div className="mt-8 text-[20px]">{issueDate}</div>
      </div>
    </div>
  );
}

function ItemsTable({ items }) {
  return (
    <div className="mt-16">
      <div
        style={{
          border: `5px solid ${BLUE}`,
          minHeight: 260,
        }}
      >
        <table className="w-full border-collapse text-[16px]">
          <thead>
            <tr style={{ background: BLUE, color: 'white' }}>
              <th className="py-2 px-2 text-left w-[60px] font-black">NO</th>
              <th className="py-2 px-2 text-left font-black">DESCRIPTION</th>
              <th className="py-2 px-2 text-center w-[100px] font-black">QTY</th>
              <th className="py-2 px-2 text-right w-[150px] font-black">PRICE</th>
              <th className="py-2 px-2 text-right w-[150px] font-black">TOTAL</th>
            </tr>
          </thead>

          <tbody>
            {items.map((item, idx) => {
              const qty = numberOrZero(item.quantity || 0);
              const unitPrice = numberOrZero(item.unitPrice || 0);
              const lineTotal = qty * unitPrice;

              return (
                <tr
                  key={`${item.description || 'item'}-${idx}`}
                  style={{
                    background: idx % 2 === 1 ? LIGHT_BLUE : 'white',
                  }}
                >
                  <td className="py-2 px-4 text-center">{idx + 1}</td>
                  <td className="py-2 px-2">{item.description || '—'}</td>
                  <td className="py-2 px-2 text-center">{qty || ''}</td>
                  <td className="py-2 px-2 text-right">
                    {formatInvoiceMoney(unitPrice)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {formatInvoiceMoney(lineTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TotalBox({ currency, total, amountPaid, balanceDue }) {
  const showBalance = numberOrZero(amountPaid) > 0;

  return (
    <div className="mt-8 flex justify-end">
      <div className="w-[430px]">
        <div
          className="grid grid-cols-[1fr_auto] items-center text-white font-black text-[18px]"
          style={{ background: BLUE }}
        >
          <div className="py-2 px-5 text-right">TOTAL {currency} :</div>
          <div className="py-2 px-3 min-w-[130px] text-right">
            {formatInvoiceMoney(total)}
          </div>
        </div>

        {showBalance ? (
          <div className="mt-2 text-[14px] text-right">
            <div>Amount Paid: {formatInvoiceMoney(amountPaid)}</div>
            <div className="font-bold">
              Balance Due: {formatInvoiceMoney(balanceDue)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaymentSection({ paymentText, senderEmail }) {
  return (
    <div className="mt-6">
      <SectionLabel>PAYMENT METHOD :</SectionLabel>

      <div className="mt-4 text-[16px] leading-[1.45] whitespace-pre-line">
        {paymentText}
      </div>

      <BlueLine width={350} />

      <div className="mt-4 text-[16px]">
        Interac e-Transfer (Canada only) Email: {senderEmail}
      </div>

      <BlueLine width={350} />
    </div>
  );
}

function TermsSection({ terms }) {
  return (
    <div className="mt-4">
      <div className="text-[18px] font-black">Term and Conditions :</div>
      <div className="mt-3 text-[15px] leading-[1.45] text-slate-600">
        {terms}
      </div>
    </div>
  );
}

function Footer({ phone, email, address }) {
  return (
    <div className="mt-10">
      <div className="flex items-center">
        <div
          style={{
            width: 72,
            height: 6,
            background: SKY_BLUE,
            borderRadius: 999,
          }}
        />
        <div
          style={{
            flex: 1,
            height: 3,
            background: BLUE,
          }}
        />
        <div
          style={{
            width: 72,
            height: 6,
            background: SKY_BLUE,
            borderRadius: 999,
          }}
        />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-5 text-[16px]">
        <FooterItem icon="☎" text={phone} />
        <FooterItem icon="✉" text={email} />
        <FooterItem icon="⌖" text={address} multiline />
      </div>
    </div>
  );
}

function FooterItem({ icon, text, multiline = false }) {
  return (
    <div className="flex items-start gap-2">
      <div
        style={{
          color: SKY_BLUE,
          fontSize: 30,
          lineHeight: 1,
          minWidth: 32,
          textAlign: 'center',
        }}
      >
        {icon}
      </div>
      <div
        className={
          multiline ? 'whitespace-pre-line leading-snug' : 'leading-[32px]'
        }
      >
        {text || '—'}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      className="inline-block text-white font-black text-[17px] tracking-wide px-4 py-2"
      style={{ background: BLUE }}
    >
      {children}
    </div>
  );
}

function BlueLine({ width = 300 }) {
  return (
    <div
      className="mt-5"
      style={{
        width,
        height: 3,
        background: BLUE,
      }}
    />
  );
}

function buildPaymentInstructions(bank, businessName) {
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

const invoicePageStyle = {
  width: '100%',
  maxWidth: 900,
  minHeight: 1160,
  padding: '58px 60px 44px',
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: TEXT,
};