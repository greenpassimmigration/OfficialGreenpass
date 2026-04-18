import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { createBlankInvoice } from '@/lib/invoiceUtils';

export default function InvoiceForm({
  invoice,
  users = [],
  bankAccounts = [],
  onChange,
  onSelectUser,
  onSelectBank,
  onReset,
}) {
  const safeInvoice = invoice || createBlankInvoice();

  const updateField = (field, value) => onChange({ ...safeInvoice, [field]: value });
  const updateSender = (field, value) => onChange({
    ...safeInvoice,
    sender: { ...(safeInvoice.sender || {}), [field]: value },
  });

  const updateItem = (index, field, value) => {
    const items = [...(safeInvoice.items || [])];
    items[index] = { ...items[index], [field]: field === 'description' ? value : Number(value) };
    onChange({ ...safeInvoice, items });
  };

  const addItem = () => onChange({
    ...safeInvoice,
    items: [...(safeInvoice.items || []), { description: '', quantity: 1, unitPrice: 0 }],
  });

  const removeItem = (index) => onChange({
    ...safeInvoice,
    items: (safeInvoice.items || []).filter((_, idx) => idx !== index),
  });

  const updateTerm = (index, value) => {
    const terms = [...(safeInvoice.terms || [])];
    terms[index] = value;
    onChange({ ...safeInvoice, terms });
  };

  const addTerm = () => onChange({ ...safeInvoice, terms: [...(safeInvoice.terms || []), ''] });
  const removeTerm = (index) => onChange({ ...safeInvoice, terms: (safeInvoice.terms || []).filter((_, idx) => idx !== index) });

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Invoice Form</CardTitle>
            <CardDescription>Admin input for the invoice preview and PDF output.</CardDescription>
          </div>
          <Button variant="outline" onClick={onReset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Invoice Number"><Input value={safeInvoice.invoiceNumber || ''} onChange={(e) => updateField('invoiceNumber', e.target.value)} /></Field>
            <Field label="Status">
              <Select value={safeInvoice.status || 'draft'} onValueChange={(v) => updateField('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Issue Date"><Input type="date" value={safeInvoice.issueDate || ''} onChange={(e) => updateField('issueDate', e.target.value)} /></Field>
            <Field label="Due Date"><Input type="date" value={safeInvoice.dueDate || ''} onChange={(e) => updateField('dueDate', e.target.value)} /></Field>
            <Field label="Currency">
              <Select value={safeInvoice.currency || 'CAD'} onValueChange={(v) => updateField('currency', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="VND">VND</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Payment Reference"><Input value={safeInvoice.paymentReference || ''} onChange={(e) => updateField('paymentReference', e.target.value)} /></Field>
          </div>

          <Field label="Client Autofill">
            <Select value={safeInvoice.selectedUserId || 'none'} onValueChange={onSelectUser}>
              <SelectTrigger><SelectValue placeholder="Choose a user" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked user</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {(user.full_name || user.name || user.email || user.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Customer Name"><Input value={safeInvoice.customerName || ''} onChange={(e) => updateField('customerName', e.target.value)} /></Field>
            <Field label="Client ID"><Input value={safeInvoice.clientId || ''} onChange={(e) => updateField('clientId', e.target.value)} /></Field>
            <Field label="Customer Email"><Input value={safeInvoice.customerEmail || ''} onChange={(e) => updateField('customerEmail', e.target.value)} /></Field>
            <Field label="Customer Phone"><Input value={safeInvoice.customerPhone || ''} onChange={(e) => updateField('customerPhone', e.target.value)} /></Field>
          </div>
          <Field label="Customer Address"><Textarea rows={3} value={safeInvoice.customerAddress || ''} onChange={(e) => updateField('customerAddress', e.target.value)} /></Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Legal Business Name"><Input value={safeInvoice.sender?.legalBusinessName || ''} onChange={(e) => updateSender('legalBusinessName', e.target.value)} /></Field>
            <Field label="Business Number"><Input value={safeInvoice.sender?.businessNumber || ''} onChange={(e) => updateSender('businessNumber', e.target.value)} /></Field>
            <Field label="Sender Email"><Input value={safeInvoice.sender?.email || ''} onChange={(e) => updateSender('email', e.target.value)} /></Field>
            <Field label="Sender Phone"><Input value={safeInvoice.sender?.phone || ''} onChange={(e) => updateSender('phone', e.target.value)} /></Field>
          </div>
          <Field label="Sender Address"><Textarea rows={3} value={safeInvoice.sender?.address || ''} onChange={(e) => updateSender('address', e.target.value)} /></Field>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Line Items</div>
                <div className="text-sm text-slate-500">Visible quantity, pricing, and subtotal rows.</div>
              </div>
              <Button type="button" variant="outline" onClick={addItem}><Plus className="w-4 h-4 mr-2" />Add Item</Button>
            </div>

            {(safeInvoice.items || []).map((item, idx) => (
              <div key={idx} className="grid md:grid-cols-[1.8fr_.5fr_.8fr_auto] gap-3 items-end rounded-2xl border p-4">
                <Field label="Description"><Input value={item.description || ''} onChange={(e) => updateItem(idx, 'description', e.target.value)} /></Field>
                <Field label="Qty"><Input type="number" min="0" step="1" value={item.quantity ?? 1} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} /></Field>
                <Field label="Unit Price"><Input type="number" min="0" step="0.01" value={item.unitPrice ?? 0} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} /></Field>
                <Button type="button" variant="ghost" onClick={() => removeItem(idx)} className="text-rose-600"><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Tax Label"><Input value={safeInvoice.taxLabel || ''} onChange={(e) => updateField('taxLabel', e.target.value)} /></Field>
            <Field label="Tax Amount"><Input type="number" min="0" step="0.01" value={safeInvoice.taxAmount ?? 0} onChange={(e) => updateField('taxAmount', Number(e.target.value))} /></Field>
            <Field label="Amount Paid"><Input type="number" min="0" step="0.01" value={safeInvoice.amountPaid ?? 0} onChange={(e) => updateField('amountPaid', Number(e.target.value))} /></Field>
            <Field label="Payment Account">
              <Select value={safeInvoice.bankAccountId || 'none'} onValueChange={onSelectBank}>
                <SelectTrigger><SelectValue placeholder="Choose bank account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No payment account</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_nickname || account.bank_name || account.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Payment Instructions"><Textarea rows={4} value={safeInvoice.paymentInstructions || ''} onChange={(e) => updateField('paymentInstructions', e.target.value)} /></Field>
          <Field label="Notes"><Textarea rows={4} value={safeInvoice.notes || ''} onChange={(e) => updateField('notes', e.target.value)} /></Field>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Terms</div>
                <div className="text-sm text-slate-500">Tighter invoice wording for the PDF and email.</div>
              </div>
              <Button type="button" variant="outline" onClick={addTerm}><Plus className="w-4 h-4 mr-2" />Add Term</Button>
            </div>
            {(safeInvoice.terms || []).map((term, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <Textarea rows={2} value={term} onChange={(e) => updateTerm(idx, e.target.value)} />
                <Button type="button" variant="ghost" className="text-rose-600" onClick={() => removeTerm(idx)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
