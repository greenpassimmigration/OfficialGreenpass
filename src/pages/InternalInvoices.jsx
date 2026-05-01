import React, { useEffect, useMemo, useState } from 'react';
import { db, auth } from '@/firebase';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Mail,
  PlusCircle,
  Printer,
  RefreshCw,
  Save,
  Search,
  CheckCircle2,
} from 'lucide-react';
import InvoiceForm from '@/components/invoice/InvoiceForm';
import InvoicePreview from '@/components/invoice/InvoicePreview';
import {
  renderInvoiceEmailHtml,
  openInvoicePrintWindow,
} from '@/lib/invoicePdf';
import {
  calcInvoiceTotals,
  createBlankInvoice,
  formatCurrency,
  normalizeInvoiceForSave,
} from '@/lib/invoiceUtils';
import { SendEmail } from '@/api/integrations';

const INVOICE_FROM_EMAIL = 'info@greenpassgroup.com';
const INVOICE_FROM_NAME = 'GreenPass';
const INVOICE_FROM_HEADER = `${INVOICE_FROM_NAME} <${INVOICE_FROM_EMAIL}>`;

export default function InternalInvoices() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [invoice, setInvoice] = useState(createBlankInvoice());
  const [invoices, setInvoices] = useState([]);
  const [users, setUsers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);

    try {
      const [userSnap, bankSnap, invoiceSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'bank_accounts')),
        getDocs(
          query(
            collection(db, 'admin_invoices'),
            orderBy('created_at', 'desc')
          )
        ),
      ]);

      const userList = userSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      const bankList = bankSnap.docs
        .map((d) => ({
          id: d.id,
          ...d.data(),
        }))
        .filter((bank) => bank.active !== false)
        .sort((a, b) => Number(b.active) - Number(a.active));

      const invoiceList = invoiceSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setUsers(userList);
      setBankAccounts(bankList);
      setInvoices(invoiceList);

      if (bankList.length && !invoice.bankAccountId) {
        applyBank(bankList[0].id, bankList, false);
      }
    } catch (error) {
      console.error('Error loading admin invoices:', error);
      alert('Failed to load invoice data.');
    } finally {
      setLoading(false);
    }
  };

  const applyUser = (userId) => {
    if (userId === 'none') {
      setInvoice((prev) => ({
        ...prev,
        selectedUserId: '',
        clientId: '',
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        customerAddress: '',
      }));
      return;
    }

    const user = users.find((entry) => entry.id === userId);
    if (!user) return;

    const address =
      typeof user.address === 'string'
        ? user.address
        : [
            user.address?.street,
            user.address?.ward,
            user.address?.district,
            user.address?.province,
            user.address?.postal_code,
            user.country,
          ]
            .filter(Boolean)
            .join(', ');

    setInvoice((prev) => ({
      ...prev,
      selectedUserId: userId,
      clientId: user.client_id || user.student_id || user.uid || user.id,
      customerName: user.full_name || user.name || '',
      customerEmail: user.email || '',
      customerPhone: user.phone || user.mobile || '',
      customerAddress:
        address ||
        [user.city, user.province, user.country].filter(Boolean).join(', '),
    }));
  };

  const applyBank = (bankId, bankList = bankAccounts, shouldUpdate = true) => {
    if (bankId === 'none') {
      if (shouldUpdate) {
        setInvoice((prev) => ({
          ...prev,
          bankAccountId: '',
          bankAccountSnapshot: null,
        }));
      }
      return null;
    }

    const bank = bankList.find((entry) => entry.id === bankId);
    if (!bank) return null;

    const updater = (prev) => ({
      ...prev,
      bankAccountId: bankId,
      bankAccountSnapshot: {
        account_nickname: bank.account_nickname || '',
        beneficiary_name: bank.beneficiary_name || '',
        bank_name: bank.bank_name || '',
        account_number: bank.account_number || '',
        branch_transit: bank.branch_transit || '',
        institution_number: bank.institution_number || '',
        swift_bic: bank.swift_bic || '',
        instructions: bank.instructions || '',
      },
      paymentInstructions: prev.paymentInstructions || bank.instructions || '',
      sender: {
        ...(prev.sender || {}),
        legalBusinessName:
          prev.sender?.legalBusinessName ||
          bank.beneficiary_name ||
          'GreenPass Immigration',
        address: prev.sender?.address || bank.beneficiary_address || '',
        email: prev.sender?.email || INVOICE_FROM_EMAIL,
      },
      currency: prev.currency || bank.currency || 'CAD',
    });

    if (shouldUpdate) {
      setInvoice(updater);
    }

    return updater(invoice);
  };

  const handleReset = () => {
    const fresh = createBlankInvoice();

    fresh.sender = {
      ...(fresh.sender || {}),
      email: fresh.sender?.email || INVOICE_FROM_EMAIL,
    };

    if (bankAccounts.length) {
      const bank = bankAccounts[0];

      fresh.bankAccountId = bank.id;
      fresh.bankAccountSnapshot = {
        account_nickname: bank.account_nickname || '',
        beneficiary_name: bank.beneficiary_name || '',
        bank_name: bank.bank_name || '',
        account_number: bank.account_number || '',
        branch_transit: bank.branch_transit || '',
        institution_number: bank.institution_number || '',
        swift_bic: bank.swift_bic || '',
        instructions: bank.instructions || '',
      };
      fresh.paymentInstructions = bank.instructions || '';
      fresh.sender = {
        ...fresh.sender,
        legalBusinessName:
          bank.beneficiary_name || fresh.sender.legalBusinessName,
        address: bank.beneficiary_address || '',
        email: fresh.sender.email || INVOICE_FROM_EMAIL,
      };
      fresh.currency = bank.currency || fresh.currency;
    }

    setInvoice(fresh);
  };

  const handleSave = async (nextStatus) => {
    setSaving(true);

    try {
      const prepared = normalizeInvoiceForSave({
        ...invoice,
        status: nextStatus || invoice.status || 'draft',
      });

      const payload = {
        ...prepared,
        created_by: auth.currentUser?.uid || null,
        updated_at: serverTimestamp(),
      };

      const existingId = invoice.id;

      if (existingId) {
        await updateDoc(doc(db, 'admin_invoices', existingId), payload);
      } else {
        payload.created_at = serverTimestamp();
        const ref = await addDoc(collection(db, 'admin_invoices'), payload);
        setInvoice((prev) => ({
          ...prev,
          id: ref.id,
        }));
      }

      await loadData();
      alert('Invoice saved successfully.');
    } catch (error) {
      console.error('Error saving invoice:', error);
      alert('Failed to save invoice.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendEmail = async () => {
    const customerEmail = String(invoice.customerEmail || '').trim();

    if (!customerEmail) {
      alert('Add a customer email before sending.');
      return;
    }

    setSending(true);

    try {
      const prepared = normalizeInvoiceForSave({
        ...invoice,
        status: invoice.status === 'paid' ? 'paid' : 'sent',
        sender: {
          ...(invoice.sender || {}),
          email: invoice.sender?.email || INVOICE_FROM_EMAIL,
        },
      });

      const result = await SendEmail({
        to: customerEmail,
        from: INVOICE_FROM_HEADER,
        replyTo: INVOICE_FROM_EMAIL,
        subject: `Invoice ${prepared.invoiceNumber}`,
        html: renderInvoiceEmailHtml(prepared),
        text: `Invoice ${prepared.invoiceNumber} for ${
          prepared.customerName || 'client'
        }`,
        headers: {
          'X-GreenPass-Reason': 'AdminInvoice',
        },
      });

      setInvoice((prev) => ({
        ...prev,
        status: prev.status === 'paid' ? 'paid' : 'sent',
      }));

      await handleSave(invoice.status === 'paid' ? 'paid' : 'sent');

      alert(
        `Invoice email queued successfully.\n\nMail document ID: ${
          result?.id || 'unknown'
        }\nSender: ${INVOICE_FROM_HEADER}`
      );
    } catch (error) {
      console.error('Error sending invoice email:', error);
      alert(error?.message || 'Failed to send invoice email.');
    } finally {
      setSending(false);
    }
  };

  const handleMarkPaid = async (invoiceRow) => {
    try {
      const totals = calcInvoiceTotals(
        invoiceRow.items || [],
        invoiceRow.taxAmount,
        invoiceRow.amountPaid
      );

      await updateDoc(doc(db, 'admin_invoices', invoiceRow.id), {
        status: 'paid',
        amountPaid: invoiceRow.total || totals.total,
        updated_at: serverTimestamp(),
      });

      await loadData();
    } catch (error) {
      console.error('Error marking invoice paid:', error);
      alert('Failed to update invoice status.');
    }
  };

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return invoices;

    return invoices.filter((entry) =>
      [
        entry.invoiceNumber,
        entry.customerName,
        entry.customerEmail,
        entry.clientId,
        entry.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [invoices, search]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-slate-950">
              Internal Invoices
            </h1>
            <p className="text-slate-600 mt-2">
              Admin-side invoice builder with preview, Firestore storage, email,
              and print-to-PDF flow.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>

            <Button variant="outline" onClick={handleReset}>
              <PlusCircle className="w-4 h-4 mr-2" />
              New Invoice
            </Button>

            <Button
              onClick={() => handleSave(invoice.status || 'draft')}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                openInvoicePrintWindow(normalizeInvoiceForSave(invoice))
              }
            >
              <Printer className="w-4 h-4 mr-2" />
              Print / PDF
            </Button>

            <Button onClick={handleSendEmail} disabled={sending}>
              {sending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Mail className="w-4 h-4 mr-2" />
              )}
              Send
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <StatsCard
            label="Draft Invoices"
            value={invoices.filter((x) => x.status === 'draft').length}
          />
          <StatsCard
            label="Sent Invoices"
            value={invoices.filter((x) => x.status === 'sent').length}
          />
          <StatsCard
            label="Paid Invoices"
            value={invoices.filter((x) => x.status === 'paid').length}
          />
          <StatsCard
            label="Open Balance"
            value={formatCurrency(
              invoices.reduce((sum, row) => {
                const totals = calcInvoiceTotals(
                  row.items || [],
                  row.taxAmount,
                  row.amountPaid
                );
                return sum + totals.balanceDue;
              }, 0),
              invoice.currency || 'CAD'
            )}
          />
        </div>

        <Tabs defaultValue="builder" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="saved">Saved Invoices</TabsTrigger>
          </TabsList>

          <TabsContent value="builder" className="space-y-6">
            <div className="grid xl:grid-cols-[1fr_1fr] gap-6 items-start">
              <InvoiceForm
                invoice={invoice}
                users={users}
                bankAccounts={bankAccounts}
                onChange={setInvoice}
                onSelectUser={applyUser}
                onSelectBank={applyBank}
                onReset={handleReset}
              />

              <InvoicePreview invoice={normalizeInvoiceForSave(invoice)} />
            </div>
          </TabsContent>

          <TabsContent value="saved">
            <Card className="rounded-3xl shadow-sm">
              <CardContent className="p-6 space-y-4">
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search invoice number, name, email, client ID"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {filteredInvoices.map((row) => {
                        const totals = calcInvoiceTotals(
                          row.items || [],
                          row.taxAmount,
                          row.amountPaid
                        );

                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              {row.invoiceNumber}
                            </TableCell>

                            <TableCell>
                              <div className="font-medium">
                                {row.customerName || '—'}
                              </div>
                              <div className="text-xs text-slate-500">
                                {row.customerEmail || row.clientId || '—'}
                              </div>
                            </TableCell>

                            <TableCell>
                              <Badge className="capitalize">
                                {row.status || 'draft'}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              {formatCurrency(totals.total, row.currency || 'CAD')}
                            </TableCell>

                            <TableCell>
                              {formatCurrency(
                                totals.balanceDue,
                                row.currency || 'CAD'
                              )}
                            </TableCell>

                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setInvoice({
                                      ...createBlankInvoice(),
                                      ...row,
                                    })
                                  }
                                >
                                  Load
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openInvoicePrintWindow(row)}
                                >
                                  <Printer className="w-4 h-4" />
                                </Button>

                                {row.status !== 'paid' ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleMarkPaid(row)}
                                  >
                                    <CheckCircle2 className="w-4 h-4 mr-1" />
                                    Paid
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function StatsCard({ label, value }) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardContent className="p-5">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-950 mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}