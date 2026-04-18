import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { calcInvoiceTotals, formatCurrency, formatDateValue, numberOrZero } from '@/lib/invoiceUtils';

export default function InvoicePreview({ invoice }) {
  const totals = calcInvoiceTotals(invoice?.items || [], invoice?.taxAmount, invoice?.amountPaid);
  const currency = invoice?.currency || 'CAD';
  const sender = invoice?.sender || {};
  const bank = invoice?.bankAccountSnapshot || {};

  return (
    <Card className="rounded-3xl shadow-sm border-slate-200 overflow-hidden">
      <CardHeader className="bg-slate-950 text-white">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-emerald-200">GreenPass</div>
            <CardTitle className="text-3xl mt-2">Invoice Preview</CardTitle>
            <p className="text-sm text-slate-300 mt-2">Client-facing invoice layout for admin billing.</p>
          </div>
          <Badge variant="secondary" className="bg-white text-slate-900 capitalize">
            {invoice?.status || 'draft'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-6 md:p-8 space-y-8 bg-white">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">From</div>
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <div className="font-semibold text-slate-950">{sender.legalBusinessName || 'GreenPass'}</div>
              {sender.businessNumber ? <div>Business No.: {sender.businessNumber}</div> : null}
              {sender.address ? <div className="whitespace-pre-line">{sender.address}</div> : null}
              {sender.email ? <div>{sender.email}</div> : null}
              {sender.phone ? <div>{sender.phone}</div> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <Meta label="Invoice #" value={invoice?.invoiceNumber} />
            <Meta label="Currency" value={currency} />
            <Meta label="Issue Date" value={formatDateValue(invoice?.issueDate)} />
            <Meta label="Due Date" value={formatDateValue(invoice?.dueDate)} />
            <Meta label="Client ID" value={invoice?.clientId || '—'} />
            <Meta label="Payment Ref" value={invoice?.paymentReference || '—'} />
          </div>
        </div>

        <Separator />

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Billed To</div>
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <div className="font-semibold text-slate-950">{invoice?.customerName || '—'}</div>
              {invoice?.customerAddress ? <div className="whitespace-pre-line">{invoice.customerAddress}</div> : null}
              {invoice?.customerEmail ? <div>{invoice.customerEmail}</div> : null}
              {invoice?.customerPhone ? <div>{invoice.customerPhone}</div> : null}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Notes</div>
            <div className="mt-2 text-sm text-slate-700 whitespace-pre-line">
              {invoice?.notes || 'Please pay the balance due by the due date shown on this invoice.'}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide text-xs">
              <tr>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3">Unit</th>
                <th className="text-right px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoice?.items || []).map((item, idx) => {
                const qty = numberOrZero(item.quantity);
                const unitPrice = numberOrZero(item.unitPrice);
                const lineTotal = qty * unitPrice;
                return (
                  <tr key={idx} className="border-t border-slate-200">
                    <td className="px-4 py-3 text-slate-800">{item.description || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{qty}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(unitPrice, currency)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">{formatCurrency(lineTotal, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-[1.2fr_.8fr] gap-6">
          <div className="space-y-6">
            <div>
              <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Terms</div>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc pl-5">
                {(invoice?.terms || []).filter(Boolean).map((term, idx) => (
                  <li key={idx}>{term}</li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Payment Instructions</div>
              <div className="mt-2 text-sm text-slate-700 whitespace-pre-line">
                {invoice?.paymentInstructions || bank?.instructions || 'Add payment instructions for the client here.'}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50 space-y-3">
            <TotalRow label="Subtotal" value={formatCurrency(totals.subtotal, currency)} />
            <TotalRow label={invoice?.taxLabel || 'Tax'} value={formatCurrency(totals.taxAmount, currency)} />
            <TotalRow label="Total" value={formatCurrency(totals.total, currency)} />
            <TotalRow label="Amount Paid" value={formatCurrency(totals.paid, currency)} />
            <Separator />
            <TotalRow label="Balance Due" value={formatCurrency(totals.balanceDue, currency)} strong />

            {(bank?.beneficiary_name || bank?.bank_name || bank?.account_number) ? (
              <div className="pt-4 text-xs text-slate-600 space-y-1">
                <div className="font-semibold text-slate-800 uppercase tracking-wide">Payment Account</div>
                {bank?.beneficiary_name ? <div>Beneficiary: {bank.beneficiary_name}</div> : null}
                {bank?.bank_name ? <div>Bank: {bank.bank_name}</div> : null}
                {bank?.account_number ? <div>Account No.: {bank.account_number}</div> : null}
                {bank?.swift_bic ? <div>SWIFT/BIC: {bank.swift_bic}</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value || '—'}</div>
    </div>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className={strong ? 'font-semibold text-slate-950' : 'text-slate-600'}>{label}</span>
      <span className={strong ? 'text-lg font-bold text-emerald-700' : 'font-semibold text-slate-950'}>{value}</span>
    </div>
  );
}
