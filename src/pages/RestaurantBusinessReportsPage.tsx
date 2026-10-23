import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as XLSX from 'xlsx-js-style';
import { getRestaurantSales } from '../modules/sales/salesService';
import {
  getRecordedReportDiscountTotal,
  getRecordedTaxSnapshotValue,
  getTaxSnapshotStatus,
  hasMissingTaxSnapshot,
} from '../modules/sales/reportCalculations';
import type { RestaurantOrder } from '../modules/ordering/orderService';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };
type ExpenseCategory = 'ingredients' | 'payroll' | 'rent' | 'utilities' | 'packaging' | 'delivery' | 'marketing' | 'maintenance' | 'supplies' | 'other';
type Expense = { id: string; expense_date: string; category: ExpenseCategory; description: string; amount: number | string; created_at: string };
type Tab = 'overview' | 'expenses' | 'payments' | 'tax' | 'journal';
type PosJournalEntry = { journal_id: number | string; occurred_at: string; transaction_id: number | string; order_id: string | null; order_number: string | null; event_type: string; operation: string; actor_user_id: string | null; actor_role: string | null; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null };

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'ingredients', label: 'Ingredients & food' }, { value: 'payroll', label: 'Payroll' },
  { value: 'rent', label: 'Rent' }, { value: 'utilities', label: 'Utilities' },
  { value: 'packaging', label: 'Packaging' }, { value: 'delivery', label: 'Delivery costs' },
  { value: 'marketing', label: 'Marketing' }, { value: 'maintenance', label: 'Maintenance' },
  { value: 'supplies', label: 'Supplies' }, { value: 'other', label: 'Other' },
];
const peso = (amount: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
const todayKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const monthStart = () => `${todayKey().slice(0, 7)}-01`;
function downloadSpreadsheet(filename: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const rowCount = rows.length;
  const navy = '17243A';
  const blue = '2563EB';
  const paleGray = 'F4F6FA';
  const border = { style: 'thin', color: { rgb: 'D9E1EE' } };
  worksheet['!cols'] = Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxLength = rows.reduce((max, row) => {
      const value = row[columnIndex];
      return Math.max(max, value == null ? 0 : String(value).length);
    }, 0);
    return { wch: Math.min(Math.max(maxLength + 2, 13), 46) };
  });
  worksheet['!rows'] = rows.map((row) => ({ hpt: row.some((value) => String(value ?? '').length > 90) ? 34 : 22 }));

  const cell = (row: number, col: number) => worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
  const firstCell = (row: number) => String(rows[row]?.[0] ?? '').trim().toLowerCase();
  const headerStarts = ['order number', 'expense date', 'tax-support sales detail', 'status'];
  const headerRows = new Set<number>();
  rows.forEach((row, index) => {
    const first = String(row[0] ?? '').trim().toLowerCase();
    if (headerStarts.some((header) => first === header || first.startsWith(header))) headerRows.add(index);
  });
  const titleRow = /^(payment reconciliation support report|tax-support sales detail)/i.test(String(rows[0]?.[0] ?? '')) ? 0 : -1;

  for (let r = 0; r < rowCount; r += 1) {
    for (let col = 0; col < columnCount; col += 1) {
      const target = cell(r, col);
      if (!target) continue;
      const isHeader = headerRows.has(r);
      const isTitle = r === titleRow;
      const isTotal = firstCell(r).includes('total') || firstCell(r).includes('completed orders in period');
      target.s = {
        font: { name: 'Aptos', sz: isTitle ? 15 : 10, bold: isTitle || isHeader || isTotal, color: { rgb: isTitle || isHeader ? 'FFFFFF' : navy } },
        fill: { patternType: 'solid', fgColor: { rgb: isTitle ? navy : isHeader ? blue : isTotal ? 'E3F4E8' : (r % 2 === 0 ? 'FFFFFF' : paleGray) } },
        alignment: { vertical: 'center', wrapText: isTitle || String(target.v ?? '').length > 38 },
        border: { bottom: border, top: isTitle ? { style: 'medium', color: { rgb: blue } } : border },
      };
      if (typeof target.v === 'number' && /php|amount|sales|total|fee|net|vat|discount|expense/i.test(String(rows[headerRows.size ? Math.max(0, r - 1) : 0]?.[col] ?? ''))) {
        target.z = '#,##0.00;[Red](#,##0.00);-';
      }
    }
  }

  if (titleRow === 0 && rowCount > 1) {
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(1, columnCount - 1) } }];
  }
  const mainHeader = [...headerRows].find((row) => row >= 0);
  if (mainHeader !== undefined && mainHeader + 1 < rowCount) {
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: mainHeader, c: 0 }, e: { r: rowCount - 1, c: columnCount - 1 } }) };
    worksheet['!freeze'] = { xSplit: 0, ySplit: mainHeader + 1 };
  } else {
    worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  XLSX.writeFile(workbook, filename, { compression: true });
}

export function RestaurantBusinessReportsPage({ restaurantId }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(todayKey);
  const [expenseDate, setExpenseDate] = useState(todayKey);
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('ingredients');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [journal, setJournal] = useState<PosJournalEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState('');

  async function loadData() {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [sales, expenseResult] = await Promise.all([
        getRestaurantSales(restaurantId),
        supabase.from('restaurant_business_expenses').select('id,expense_date,category,description,amount,created_at').eq('restaurant_id', restaurantId).order('expense_date', { ascending: false }).limit(2000),
      ]);
      if (expenseResult.error) throw expenseResult.error;
      setOrders(sales);
      setExpenses((expenseResult.data ?? []) as Expense[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load business reports. Apply the business expenses database migration if this is the first setup.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadData(); }, [restaurantId]);

  useEffect(() => {
    if (tab === 'journal') void loadJournal();
  }, [tab, restaurantId, fromDate, toDate]);

  const rangeOrders = useMemo(() => orders.filter((order) => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(order.createdAt));
    return date >= fromDate && date <= toDate;
  }), [orders, fromDate, toDate]);
  const completedOrders = useMemo(() => rangeOrders.filter((order) => order.status === 'completed'), [rangeOrders]);
  const rangeExpenses = useMemo(() => expenses.filter((expense) => expense.expense_date >= fromDate && expense.expense_date <= toDate), [expenses, fromDate, toDate]);
  const totalSales = completedOrders.reduce((sum, order) => sum + order.total, 0);
  const discounts = completedOrders.reduce((sum, order) => sum + getRecordedReportDiscountTotal(order), 0);
  const ordersMissingTaxSnapshots = rangeOrders.filter(hasMissingTaxSnapshot);
  const completedOrdersMissingTaxSnapshots = completedOrders.filter(hasMissingTaxSnapshot);
  const taxSnapshotComplete = completedOrdersMissingTaxSnapshots.length === 0;
  const completedOrdersWithTaxSnapshots = completedOrders.filter((order) => !hasMissingTaxSnapshot(order));
  const taxSales = completedOrdersWithTaxSnapshots.reduce((sum, order) => sum + (order.taxNetSales ?? 0), 0);
  const outputVat = completedOrdersWithTaxSnapshots.reduce((sum, order) => sum + (order.taxVatAmount ?? 0), 0);
  const totalExpenses = rangeExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const estimatedOperatingResult = totalSales - totalExpenses;
  const vatConfiguredOrders = completedOrders.filter((order) => order.taxVatRegistered).length;
  const paymentTotals = useMemo(() => {
    const statuses = ['paid', 'pending', 'failed', 'refunded'] as const;
    return statuses.map((status) => ({
      status,
      count: rangeOrders.filter((order) => order.paymentStatus === status).length,
      amount: rangeOrders.filter((order) => order.paymentStatus === status).reduce((sum, order) => sum + order.total, 0),
    }));
  }, [rangeOrders]);
  const paymentMethods = useMemo(() => {
    const methods = ['cash', 'gcash'] as const;
    return methods.map((method) => ({
      method,
      count: rangeOrders.filter((order) => order.paymentMethod === method).length,
      paidAmount: rangeOrders.filter((order) => order.paymentMethod === method && order.paymentStatus === 'paid').reduce((sum, order) => sum + order.total, 0),
      outstandingAmount: rangeOrders.filter((order) => order.paymentMethod === method && ['pending', 'failed'].includes(order.paymentStatus)).reduce((sum, order) => sum + order.total, 0),
      providerFees: rangeOrders.filter((order) => order.paymentMethod === method && order.paymentStatus === 'paid').reduce((sum, order) => sum + (order.paymongoFee ?? 0), 0),
      recordedNet: rangeOrders.filter((order) => order.paymentMethod === method && order.paymentStatus === 'paid').reduce((sum, order) => sum + (order.paymongoNetAmount ?? 0), 0),
    }));
  }, [rangeOrders]);

  async function loadJournal(): Promise<PosJournalEntry[] | null> {
    if (!supabase) {
      setJournalError('Supabase is not configured.');
      return null;
    }
    setJournalLoading(true);
    setJournalError('');
    try {
      const fromBoundary = new Date(`${fromDate}T00:00:00+08:00`).toISOString();
      const toBoundaryDate = new Date(`${toDate}T00:00:00+08:00`);
      toBoundaryDate.setUTCDate(toBoundaryDate.getUTCDate() + 1);
      const { data, error: journalLoadError } = await supabase.rpc('get_restaurant_pos_sales_journal', {
        p_restaurant_id: restaurantId,
        p_from: fromBoundary,
        p_to: toBoundaryDate.toISOString(),
        p_limit: 5000,
      });
      if (journalLoadError) throw journalLoadError;
      const entries = (data ?? []) as unknown as PosJournalEntry[];
      setJournal(entries);
      return entries;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load the POS activity journal.';
      setJournalError(message);
      return null;
    } finally {
      setJournalLoading(false);
    }
  }

  async function exportJournal() {
    const entries = await loadJournal();
    if (entries === null) return;
    downloadSpreadsheet(`pos-activity-journal-${fromDate}-to-${toDate}.xlsx`, [
      ['POS activity journal (append-only platform record; not a BIR approval/certificate)',''],
      ['Period start', fromDate],
      ['Period end', toDate],
      ['Exported at', new Date().toISOString()],
      ['Important note','This journal records order, item, payment, financial and tax snapshot state changes captured after the journal migration. It is not represented as a BIR-certified e-Journal and does not replace required invoice issuance, readings, backend reports, or transmission until the applicable BIR route is confirmed.'],
      [],
      ['Journal ID','Occurred at','Database transaction ID','Order number','Order ID','Event','Operation','Actor user ID','Actor role','Old values JSON','New values JSON'],
      ...entries.map((entry) => [
        entry.journal_id, entry.occurred_at, entry.transaction_id, entry.order_number ?? '', entry.order_id ?? '',
        entry.event_type, entry.operation, entry.actor_user_id ?? '', entry.actor_role ?? '',
        entry.old_values ? JSON.stringify(entry.old_values) : '',
        entry.new_values ? JSON.stringify(entry.new_values) : '',
      ]),
    ]);
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!supabase) { setError('Supabase is not configured.'); return; }
    const amount = Number(expenseAmount);
    if (!expenseDescription.trim() || !Number.isFinite(amount) || amount <= 0) { setError('Enter an expense description and an amount greater than zero.'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from('restaurant_business_expenses').insert({
        restaurant_id: restaurantId, expense_date: expenseDate, category: expenseCategory,
        description: expenseDescription.trim(), amount, created_by: user?.id ?? null,
      });
      if (insertError) throw insertError;
      setExpenseDescription(''); setExpenseAmount('');
      setNotice('Expense saved.');
      await loadData();
      setTab('expenses');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save expense. Check that the expense-tracking migration has been applied.');
    } finally { setSaving(false); }
  }

  async function deleteExpense(id: string) {
    if (!supabase || !window.confirm('Delete this expense record?')) return;
    setError(''); setNotice('');
    const { error: deleteError } = await supabase.from('restaurant_business_expenses').delete().eq('id', id).eq('restaurant_id', restaurantId);
    if (deleteError) { setError(deleteError.message); return; }
    setExpenses((current) => current.filter((expense) => expense.id !== id));
    setNotice('Expense deleted.');
  }

  function exportSales() {
    downloadSpreadsheet(`sales-report-${fromDate}-to-${toDate}.xlsx`, [
      ['Order number','Order date','Status','Order type','Payment method','Payment status','Order total PHP','Discounts PHP','Net sales per order record PHP','Taxable sales PHP','VAT amount PHP','VAT-exempt sales PHP','VAT registration snapshot','Tax snapshot status'],
      ...rangeOrders.map((order) => [order.orderNumber, order.createdAt, order.status, order.orderType, order.paymentMethod, order.paymentStatus, order.total, getRecordedReportDiscountTotal(order), getRecordedTaxSnapshotValue(order, order.taxNetSales), getRecordedTaxSnapshotValue(order, order.taxVatableSales), getRecordedTaxSnapshotValue(order, order.taxVatAmount), getRecordedTaxSnapshotValue(order, order.taxVatExemptSales), hasMissingTaxSnapshot(order) ? 'Unverified' : order.taxVatRegistered ? 'Yes' : 'No', getTaxSnapshotStatus(order)]),
    ]);
  }

  function exportTaxSupport() {
    downloadSpreadsheet(`tax-support-sales-${fromDate}-to-${toDate}.xlsx`, [
      ['Tax-support sales detail (not an official tax return or invoice)',''],
      ['Period start', fromDate], ['Period end', toDate],
      ['Report generated', new Date().toISOString()],
      ['Note','For positive-total orders, tax values are exported only when the order is explicitly marked as having a calculated snapshot and has a positive gross-sales snapshot. Legacy, uncalculated or review-required snapshots are left blank. Period net-sales and VAT totals are marked incomplete if any completed order in the period lacks a verified calculation state. A calculated snapshot is not independently validated for tax compliance.'],
      [],
      ['Order number','Transaction date','Order status','Payment status','Order total PHP','Discount amount PHP','Recorded net sales PHP','Recorded vatable sales PHP','Recorded VAT amount PHP','Recorded VAT-exempt sales PHP','VAT registration snapshot','Tax snapshot status'],
      ...rangeOrders.map((order) => [order.orderNumber, order.createdAt, order.status, order.paymentStatus, order.total, getRecordedReportDiscountTotal(order), getRecordedTaxSnapshotValue(order, order.taxNetSales), getRecordedTaxSnapshotValue(order, order.taxVatableSales), getRecordedTaxSnapshotValue(order, order.taxVatAmount), getRecordedTaxSnapshotValue(order, order.taxVatExemptSales), hasMissingTaxSnapshot(order) ? 'Unverified' : order.taxVatRegistered ? 'Yes' : 'No', getTaxSnapshotStatus(order)]),
      [],
      ['Orders in period with missing tax snapshots', ordersMissingTaxSnapshots.length],
      ['Completed orders in period', completedOrders.length], ['Completed order totals PHP', totalSales],
      ['Completed orders missing tax snapshots', completedOrdersMissingTaxSnapshots.length],
      ['Recorded net sales total PHP', taxSnapshotComplete ? taxSales : 'INCOMPLETE — one or more completed orders lack tax snapshots'],
      ['Recorded VAT total PHP', taxSnapshotComplete ? outputVat : 'INCOMPLETE — one or more completed orders lack tax snapshots'],
    ]);
  }

  function exportPayments() {
    downloadSpreadsheet(`payment-reconciliation-${fromDate}-to-${toDate}.xlsx`, [
      ['Payment reconciliation support report (not a provider settlement statement)',''],
      ['Period start', fromDate], ['Period end', toDate], ['Report generated', new Date().toISOString()],
      ['Note','Amounts and statuses are from recorded order data. Verify GCash/PayMongo settlements and bank deposits against your payment-provider statements. Missing fee/net fields are left blank in detail rows.'],
      [],
      ['Order number','Order date','Order status','Payment method','Payment status','Order total PHP','Recorded provider payment method','PayMongo payment ID','PayMongo checkout session ID','Recorded PayMongo fee PHP','Recorded PayMongo net amount PHP'],
      ...rangeOrders.map((order) => [order.orderNumber, order.createdAt, order.status, order.paymentMethod, order.paymentStatus, order.total, order.paymongoPaymentMethod ?? '', order.paymongoPaymentId ?? '', order.paymongoCheckoutSessionId ?? '', order.paymongoFee ?? '', order.paymongoNetAmount ?? '']),
      [], ['Status','Order count','Order total PHP'],
      ...paymentTotals.map((item) => [item.status, item.count, item.amount]),
    ]);
  }

  function exportExpenses() {
    downloadSpreadsheet(`expenses-${fromDate}-to-${toDate}.xlsx`, [
      ['Expense date','Category','Description','Amount PHP'],
      ...rangeExpenses.map((expense) => [expense.expense_date, CATEGORIES.find((item) => item.value === expense.category)?.label ?? expense.category, expense.description, Number(expense.amount)]),
      ['Total expenses PHP','','', totalExpenses],
    ]);
  }

  return (
    <section className="restaurant-page restaurant-business-reports">
      <style>{`
        .restaurant-business-reports{display:grid;gap:20px;max-width:1240px}
        .business-reports-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
        .business-reports-header h1{margin:0 0 6px;font-size:clamp(24px,3vw,32px);letter-spacing:-.03em}
        .business-reports-header p{margin:0;color:var(--muted,#64748b);max-width:720px;line-height:1.5}
        .business-reports-range,.business-reports-form-grid{display:flex;align-items:end;gap:12px;flex-wrap:wrap}
        .business-reports-range label,.business-reports-form label{display:grid;gap:5px;font-size:12px;font-weight:650;color:var(--text,#202938)}
        .business-reports-range input{box-sizing:border-box;min-height:36px;border:1px solid var(--border,#dce2ea);border-radius:8px;padding:5px 8px;background:var(--surface,#fff);color:inherit;font:600 12px/1.2 var(--font-ui,inherit);width:128px}
        .business-reports-form input,.business-reports-form select{box-sizing:border-box;min-height:40px;border:1px solid var(--border,#dce2ea);border-radius:9px;padding:8px 10px;background:var(--surface,#fff);color:inherit;font:inherit}
        .business-reports-tabs{display:flex;gap:24px;flex-wrap:wrap;border-bottom:1px solid var(--border,#e2e8f0);padding-bottom:0}
        .business-reports-tabs button{position:relative;appearance:none;border:0;border-radius:0;background:transparent;color:var(--muted,#64748b);padding:10px 0 12px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
        .business-reports-tabs button:hover{color:var(--text,#111827)}
        .business-reports-tabs button[aria-selected=true]{background:transparent;color:var(--text,#111827);font-weight:750}
        .business-reports-tabs button[aria-selected=true]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--color-primary,#111827);border-radius:2px}
        .business-reports-button{border:1px solid var(--border,#dce2ea);border-radius:9px;background:var(--surface,#fff);color:var(--text,#202938);padding:10px 14px;font:inherit;font-weight:650;cursor:pointer}
        .business-reports-button.primary{background:var(--color-primary,#111827);color:#fff;border-color:var(--color-primary,#111827)}
        .business-reports-button.business-reports-export{background:var(--surface,#fff);color:var(--text,#202938);border-color:var(--border,#dce2ea)}
        .business-reports-button.business-reports-export:hover:not(:disabled){background:var(--surface,#fff);color:var(--text,#202938);border-color:var(--border-strong,var(--border,#cbd5e1))}
        .business-reports-button:disabled{opacity:.55;cursor:wait}
        .business-reports-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
        .business-reports-card,.business-reports-panel{border:1px solid var(--border,#e2e8f0);border-radius:14px;background:var(--surface,#fff);padding:17px;min-width:0}
        .business-reports-card small{display:block;color:var(--muted,#64748b);font-size:12px;margin-bottom:9px}
        .business-reports-card strong{font-size:clamp(17px,2vw,24px);letter-spacing:-.03em;overflow-wrap:anywhere}
        .business-reports-panel h2{font-size:18px;margin:0 0 8px}
        .business-reports-panel p{color:var(--muted,#64748b);font-size:13px;line-height:1.5}
        .business-reports-table-wrap{overflow:auto}
        .business-reports-table{width:100%;border-collapse:collapse;font-size:13px}
        .business-reports-table th,.business-reports-table td{padding:11px 10px;border-bottom:1px solid var(--border,#e2e8f0);text-align:left;white-space:nowrap}
        .business-reports-table th{color:var(--muted,#64748b);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        .business-reports-table td.wrap{white-space:normal;min-width:140px}
        .business-reports-form{display:grid;gap:14px}
        .business-reports-form-grid>*{flex:1 1 180px}
        .business-reports-notice{padding:12px 14px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:13px}
        .business-reports-error{padding:12px 14px;border-radius:10px;background:#fef2f2;color:#991b1b;font-size:13px}
        .business-reports-muted{color:var(--muted,#64748b);font-size:12px;line-height:1.5}
        .business-reports-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        @media(max-width:760px){.business-reports-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.business-reports-card,.business-reports-panel{padding:13px}.business-reports-range{align-items:stretch}.business-reports-range label{flex:1 1 130px}.business-reports-range input{width:100%}}
      `}</style>
      <nav className="business-reports-tabs" role="tablist" aria-label="Business report sections">
        {([['overview','Overview'],['expenses','Expenses & Profit'],['payments','Payments'],['tax','Tax Reports'],['journal','Activity Journal']] as [Tab,string][]).map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={tab===key} onClick={() => {setTab(key);setError('');setNotice('');setJournalError('');}}>{label}</button>)}
      </nav>
      {error && <div className="business-reports-error" role="alert">{error}</div>}
      {notice && <div className="business-reports-notice" role="status">{notice}</div>}
      {loading ? <div className="business-reports-panel">Loading business data…</div> : <>
        {tab === 'overview' && <>
          <div className="business-reports-cards">
            <div className="business-reports-card"><small>Completed sales</small><strong>{peso(totalSales)}</strong></div>
            <div className="business-reports-card"><small>Completed orders</small><strong>{completedOrders.length}</strong></div>
            <div className="business-reports-card"><small>Average order value</small><strong>{peso(completedOrders.length ? totalSales / completedOrders.length : 0)}</strong></div>
            <div className="business-reports-card"><small>Recorded expenses</small><strong>{peso(totalExpenses)}</strong></div>
          </div>
          <section className="business-reports-panel">
            <div className="business-reports-header">
              <div><h2>Sales by day</h2><p>Completed orders only. Cancelled and incomplete orders are not included in sales totals.</p></div>
              <div className="business-reports-range">
                <label>From<input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></label>
                <label>To<input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} /></label>
              </div>
            </div>
            <div className="business-reports-table-wrap"><table className="business-reports-table"><thead><tr><th>Date</th><th>Completed orders</th><th>Sales</th></tr></thead><tbody>
              {Array.from(new Set(completedOrders.map((order) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(order.createdAt))))).sort((a,b)=>b.localeCompare(a)).map((date) => {
                const dayOrders = completedOrders.filter((order) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(order.createdAt)) === date);
                return <tr key={date}><td>{date}</td><td>{dayOrders.length}</td><td>{peso(dayOrders.reduce((sum,order)=>sum+order.total,0))}</td></tr>;
              })}
              {!completedOrders.length && <tr><td colSpan={3}>No completed orders in this period.</td></tr>}
            </tbody></table></div>
            <div className="business-reports-actions" style={{ justifyContent: 'flex-end' }}><button className="business-reports-button business-reports-export restaurant-export-button restaurant-compact-action" type="button" onClick={exportSales}>Export sales (.xlsx)</button></div>
          </section>
        </>}
        {tab === 'expenses' && <>
          <div className="business-reports-cards">
            <div className="business-reports-card"><small>Completed sales</small><strong>{peso(totalSales)}</strong></div>
            <div className="business-reports-card"><small>Recorded expenses</small><strong>{peso(totalExpenses)}</strong></div>
            <div className="business-reports-card"><small>Estimated operating result</small><strong>{peso(estimatedOperatingResult)}</strong></div>
            <div className="business-reports-card"><small>Expense entries</small><strong>{rangeExpenses.length}</strong></div>
          </div>
          <p className="business-reports-muted">Estimated operating result = completed order totals minus expenses entered here. This is not net profit or a tax calculation; ingredient costs, taxes, platform fees, and other unrecorded costs may be missing.</p>
          <section className="business-reports-panel"><h2>Add an expense</h2><form className="business-reports-form" onSubmit={addExpense}>
            <div className="business-reports-form-grid">
              <label>Date<input type="date" value={expenseDate} required onChange={(event)=>setExpenseDate(event.target.value)} /></label>
              <label>Category<select value={expenseCategory} onChange={(event)=>setExpenseCategory(event.target.value as ExpenseCategory)}>{CATEGORIES.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Amount (₱)<input type="number" min="0.01" step="0.01" value={expenseAmount} required placeholder="0.00" onChange={(event)=>setExpenseAmount(event.target.value)} /></label>
              <label>Description<input value={expenseDescription} required maxLength={240} placeholder="e.g. Fresh produce delivery" onChange={(event)=>setExpenseDescription(event.target.value)} /></label>
            </div>
            <div className="business-reports-actions" style={{ justifyContent: 'flex-end' }}><button className="business-reports-button primary restaurant-compact-action" type="submit" disabled={saving}>{saving?'Saving…':'Save'}</button><button className="business-reports-button business-reports-export restaurant-export-button restaurant-compact-action" type="button" onClick={exportExpenses}>Export expenses (.xlsx)</button></div>
          </form></section>
          <section className="business-reports-panel"><h2>Expenses in selected period</h2><div className="business-reports-table-wrap"><table className="business-reports-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>
            {rangeExpenses.map((expense)=><tr key={expense.id}><td>{expense.expense_date}</td><td>{CATEGORIES.find((item)=>item.value===expense.category)?.label ?? expense.category}</td><td className="wrap">{expense.description}</td><td>{peso(Number(expense.amount))}</td><td><button className="business-reports-button" type="button" onClick={()=>void deleteExpense(expense.id)}>Delete</button></td></tr>)}
            {!rangeExpenses.length && <tr><td colSpan={5}>No expenses recorded for this period.</td></tr>}
          </tbody></table></div></section>
        </>}
        {tab === 'payments' && <>
          <div className="business-reports-cards">
            <div className="business-reports-card"><small>Recorded as paid</small><strong>{peso(paymentTotals.find((item) => item.status === 'paid')?.amount ?? 0)}</strong></div>
            <div className="business-reports-card"><small>Pending payment</small><strong>{peso(paymentTotals.find((item) => item.status === 'pending')?.amount ?? 0)}</strong></div>
            <div className="business-reports-card"><small>Failed payment</small><strong>{peso(paymentTotals.find((item) => item.status === 'failed')?.amount ?? 0)}</strong></div>
            <div className="business-reports-card"><small>Refunded orders</small><strong>{peso(paymentTotals.find((item) => item.status === 'refunded')?.amount ?? 0)}</strong></div>
          </div>
          <section className="business-reports-panel"><h2>Payment status summary</h2>
            <p>All orders created in the selected date range are shown here, including orders that are not completed. “Paid” means the order record says paid; it does not independently confirm a provider settlement or bank deposit.</p>
            <div className="business-reports-table-wrap"><table className="business-reports-table"><thead><tr><th>Recorded payment status</th><th>Orders</th><th>Order total</th></tr></thead><tbody>
              {paymentTotals.map((item) => <tr key={item.status}><td>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</td><td>{item.count}</td><td>{peso(item.amount)}</td></tr>)}
              {!rangeOrders.length && <tr><td colSpan={3}>No orders in this period.</td></tr>}
            </tbody></table></div>
          </section>
          <section className="business-reports-panel"><h2>Payment method breakdown</h2>
            <div className="business-reports-table-wrap"><table className="business-reports-table"><thead><tr><th>Method</th><th>Orders</th><th>Recorded paid total</th><th>Pending/failed total</th><th>Recorded provider fees</th><th>Recorded provider net</th></tr></thead><tbody>
              {paymentMethods.map((item) => <tr key={item.method}><td>{item.method === 'gcash' ? 'GCash / online' : 'Cash'}</td><td>{item.count}</td><td>{peso(item.paidAmount)}</td><td>{peso(item.outstandingAmount)}</td><td>{item.method === 'gcash' ? peso(item.providerFees) : '—'}</td><td>{item.method === 'gcash' ? peso(item.recordedNet) : '—'}</td></tr>)}
            </tbody></table></div>
            <p className="business-reports-muted">Provider fees and net amounts are displayed only when recorded on the order. Zero may mean no value was recorded, not necessarily a zero-fee transaction. Refunded amounts are listed separately in the status summary.</p>
            <div className="business-reports-actions" style={{ justifyContent: 'flex-end' }}><button className="business-reports-button business-reports-export restaurant-export-button restaurant-compact-action" type="button" onClick={exportPayments}>Export payment reconciliation (.xlsx)</button></div>
          </section>
          <section className="business-reports-panel"><h2>Orders to review</h2>
            <div className="business-reports-table-wrap"><table className="business-reports-table"><thead><tr><th>Order</th><th>Date</th><th>Order status</th><th>Method</th><th>Payment status</th><th>Amount</th></tr></thead><tbody>
              {rangeOrders.filter((order) => ['pending','failed','refunded'].includes(order.paymentStatus)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((order) => <tr key={order.orderId}><td>{order.orderNumber}</td><td>{order.createdAt.slice(0,10)}</td><td>{order.status}</td><td>{order.paymentMethod === 'gcash' ? 'GCash / online' : 'Cash'}</td><td>{order.paymentStatus}</td><td>{peso(order.total)}</td></tr>)}
              {!rangeOrders.some((order) => ['pending','failed','refunded'].includes(order.paymentStatus)) && <tr><td colSpan={6}>No pending, failed, or refunded payment records in this period.</td></tr>}
            </tbody></table></div>
          </section>
        </>}
        {tab === 'journal' && <>
          <section className="business-reports-panel">
            <div className="business-reports-panel-heading">
              <div><h2>POS activity journal</h2><p>Append-only history of order, line-item, payment, financial and tax-snapshot changes for the selected period.</p></div>
              <div className="business-reports-actions">
                <button className="business-reports-button" type="button" onClick={() => void loadJournal()} disabled={journalLoading}>{journalLoading ? 'Loading…' : 'Refresh journal'}</button>
                <button className="business-reports-button business-reports-export restaurant-export-button restaurant-compact-action" type="button" onClick={() => void exportJournal()} disabled={journalLoading}>Export journal (.xlsx)</button>
              </div>
            </div>
            <p className="business-reports-muted">The export includes before/after values for auditable changes while excluding customer name, contact number, delivery address, and statutory-discount ID numbers from journal snapshots. This is a technical audit journal, not a BIR-issued accreditation or proof that the prescribed e-Journal format has been accepted.</p>
            {journalError && <p className="business-reports-error" role="alert">{journalError}</p>}
            <div className="business-reports-table-wrap"><table className="business-reports-table">
              <thead><tr><th>When (Manila)</th><th>Order</th><th>Event</th><th>Operation</th><th>Actor</th><th>Recorded state</th></tr></thead>
              <tbody>
                {journal.map((entry) => <tr key={String(entry.journal_id)}>
                  <td>{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(entry.occurred_at))}</td>
                  <td>{entry.order_number ?? '—'}</td><td>{entry.event_type}</td><td>{entry.operation}</td>
                  <td>{entry.actor_role ?? 'Database'}{entry.actor_user_id ? <small style={{ display: 'block' }}>{entry.actor_user_id}</small> : null}</td>
                  <td><details><summary>Before / after</summary><pre style={{ whiteSpace: 'pre-wrap', maxWidth: 420, overflowWrap: 'anywhere' }}>{JSON.stringify({ before: entry.old_values, after: entry.new_values }, null, 2)}</pre></details></td>
                </tr>)}
                {journal.length === 0 && <tr><td colSpan={6}>{journalLoading ? 'Loading activity…' : 'No journal events found for this period.'}</td></tr>}
              </tbody>
            </table></div>
            <p className="business-reports-muted">Showing up to 5,000 newest captured events. The journal begins recording from deployment onward and does not reconstruct events that happened before it existed.</p>
          </section>
        </>}
        {tab === 'tax' && <>
          <div className="business-reports-cards">
            <div className="business-reports-card"><small>Completed sales</small><strong>{peso(totalSales)}</strong></div>
            <div className="business-reports-card"><small>Discounts recorded</small><strong>{peso(discounts)}</strong></div>
            <div className="business-reports-card"><small>Recorded net sales</small><strong>{taxSnapshotComplete ? peso(taxSales) : 'Incomplete'}</strong></div>
            <div className="business-reports-card"><small>Recorded output VAT</small><strong>{taxSnapshotComplete ? peso(outputVat) : 'Incomplete'}</strong></div>
          </div>
          {ordersMissingTaxSnapshots.length > 0 && <p className="business-reports-error" role="alert">{ordersMissingTaxSnapshots.length} order(s) in this period have tax snapshots that are legacy-unverified, not calculated, missing, or marked for review. Tax fields are intentionally left blank until the server-side calculation status is confirmed. These supporting reports are not a substitute for an accountant's review.</p>}
          <section className="business-reports-panel"><h2>Tax-support exports</h2>
            <p>These files summarize order and tax fields already recorded by the platform. They are supporting records for review by your accountant, not official BIR invoices, books, returns, or confirmation that your business is tax-compliant. No tax rate is inferred when order tax data is missing.</p>
            <p className="business-reports-muted">Orders with VAT registration recorded: {vatConfiguredOrders} of {completedOrders.length} completed orders in this period. Completed orders missing tax snapshots: {completedOrdersMissingTaxSnapshots.length}. Check your business registration and tax treatment with your accountant before relying on these totals.</p>
            <div className="business-reports-actions" style={{ justifyContent: 'flex-end' }}><button className="business-reports-button business-reports-export restaurant-export-button restaurant-compact-action" type="button" onClick={exportTaxSupport}>Export tax-support (.xlsx)</button><button className="business-reports-button business-reports-export restaurant-export-button restaurant-compact-action" type="button" onClick={exportSales}>Export detailed sales (.xlsx)</button></div>
          </section>
          <section className="business-reports-panel"><h2>Included in the export</h2><ul><li>Order number, date, status, and payment status</li><li>Recorded order amount and discounts</li><li>Recorded net sales, vatable sales, VAT amount, and VAT-exempt sales when available</li></ul><p>Tax status and amounts are taken from existing order records. Review data quality and applicable requirements before filing.</p></section>
        </>}
      </>}
    </section>
  );
}
