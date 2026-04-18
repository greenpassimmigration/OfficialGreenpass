export const DEFAULT_CURRENCY = 'CAD';
export const DEFAULT_TAX_LABEL = 'Tax';

export function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  return Math.round(numberOrZero(value) * 100) / 100;
}

export function calcLineTotal(item = {}) {
  return roundMoney(numberOrZero(item.quantity || 0) * numberOrZero(item.unitPrice || 0));
}

export function calcInvoiceTotals(items = [], tax = 0, amountPaid = 0) {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + calcLineTotal(item), 0));
  const taxAmount = roundMoney(numberOrZero(tax));
  const total = roundMoney(subtotal + taxAmount);
  const paid = roundMoney(amountPaid);
  const balanceDue = roundMoney(total - paid);
  return { subtotal, taxAmount, total, paid, balanceDue };
}

export function formatCurrency(amount, currency = DEFAULT_CURRENCY, locale = 'en-CA') {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || DEFAULT_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numberOrZero(amount));
  } catch {
    return `${currency || DEFAULT_CURRENCY} ${numberOrZero(amount).toFixed(2)}`;
  }
}

export function formatDateValue(value) {
  if (!value) return '—';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(d?.getTime?.())) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

export function createInvoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GP-${stamp}-${rand}`;
}

export function createBlankInvoice() {
  const issue = new Date();
  const due = new Date(issue);
  due.setDate(due.getDate() + 7);
  return {
    invoiceNumber: createInvoiceNumber(),
    issueDate: issue.toISOString().slice(0, 10),
    dueDate: due.toISOString().slice(0, 10),
    status: 'draft',
    currency: DEFAULT_CURRENCY,
    clientId: '',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    customerAddress: '',
    notes: '',
    paymentReference: '',
    paymentInstructions: '',
    taxLabel: DEFAULT_TAX_LABEL,
    taxAmount: 0,
    amountPaid: 0,
    sender: {
      legalBusinessName: 'GreenPass Immigration',
      businessNumber: '',
      email: '',
      phone: '',
      address: '',
    },
    bankAccountId: '',
    bankAccountSnapshot: null,
    items: [
      { description: 'Service Fee', quantity: 1, unitPrice: 0 },
    ],
    terms: [
      'Fees are for professional service assistance only.',
      'Government fees and third-party fees are separate unless listed on this invoice.',
      'Payment confirms agreement to the applicable service terms.',
      'Processing timelines depend on document completeness and official processing bodies.',
    ],
  };
}

export function normalizeInvoiceForSave(invoice = {}) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const cleanedItems = items
    .map((item) => ({
      description: String(item.description || '').trim(),
      quantity: numberOrZero(item.quantity || 0),
      unitPrice: roundMoney(item.unitPrice || 0),
      lineTotal: calcLineTotal(item),
    }))
    .filter((item) => item.description || item.quantity || item.unitPrice);

  const totals = calcInvoiceTotals(cleanedItems, invoice.taxAmount, invoice.amountPaid);

  return {
    ...invoice,
    items: cleanedItems,
    ...totals,
    taxAmount: totals.taxAmount,
    amountPaid: totals.paid,
  };
}
