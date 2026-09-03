/**
 * Reads REAL pending payments from your database and writes
 * /tmp/test-import.xlsx — ready to upload via the Import Excel button.
 *
 * Column layout matches generateImportTemplate() exactly:
 *   Col A: Buyer Name       (read-only)
 *   Col B: Phone            (read-only — matching key)
 *   Col C: Email            (read-only)
 *   Col D: Ticket Numbers   (read-only, green)
 *   Col E: Qty              (read-only)
 *   Col F: Amount (ETB)     (read-only)
 *   Col G: Current Status   (read-only)
 *   Col H: Status           (EDITABLE dropdown: APPROVED / REJECTED / PENDING)
 *   Col I: Notes / Reject Reason  (editable)
 *
 * Reference Code and Lottery Name are intentionally excluded —
 * the backend matches payments by phone number.
 *
 * Usage:
 *   node generate-test-import.js                      # up to 20 rows, any lottery
 *   node generate-test-import.js --lottery "My Lottery"  # filter to one lottery name
 *   node generate-test-import.js --take 10            # limit row count
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const ExcelJS          = require('exceljs');
const path             = require('path');

const prisma = new PrismaClient();

// ── CLI args ────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const lotteryFlag = args.indexOf('--lottery');
const lotteryName = lotteryFlag !== -1 ? args[lotteryFlag + 1] : null;
const takeFlag    = args.indexOf('--take');
const takeN       = takeFlag !== -1 ? parseInt(args[takeFlag + 1], 10) : 20;

// Status plan for rows (cycles if more rows than entries)
const STATUS_PLAN = [
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'PENDING',  notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'PENDING',  notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'PENDING',  notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'PENDING',  notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
  { status: 'APPROVED', notes: '' },
];

async function main() {
  // 1. Find an active client
  const client = await prisma.client.findFirst({ where: { status: 'ACTIVE' } });
  if (!client) throw new Error('No ACTIVE client found in the database.');
  console.log(`Client : ${client.name} (${client.id})`);

  // 2. Build where clause — optionally filter by lottery name
  let lotteryId = undefined;
  if (lotteryName) {
    const lot = await prisma.lottery.findFirst({
      where: { clientId: client.id, name: { contains: lotteryName, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!lot) throw new Error(`No lottery found matching "${lotteryName}" for this client.`);
    lotteryId = lot.id;
    console.log(`Lottery: ${lot.name} (filtered)`);
  }

  // 3. Fetch real pending payments
  const payments = await prisma.paymentTransaction.findMany({
    where: {
      clientId:  client.id,
      status:    { in: ['INITIATED', 'SUBMITTED', 'UNDER_REVIEW'] },
      deletedAt: null,
      ...(lotteryId ? { lotteryId } : {}),
    },
    include: {
      buyer:   { select: { name: true, phone: true, email: true } },
      lottery: { select: { name: true } },
      tickets: { select: { ticketNumber: true }, orderBy: { ticketNumber: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: takeN,
  });

  if (payments.length === 0) {
    console.log('\nNo pending payments found (SUBMITTED or UNDER_REVIEW).');
    console.log('Create some test payments first, then re-run this script.');
    await prisma.$disconnect();
    return;
  }

  // Derive lottery name for the label row
  const resolvedLotteryName = lotteryId
    ? payments[0]?.lottery?.name ?? lotteryName
    : payments.length > 0
      ? (payments.every(p => p.lottery?.name === payments[0]?.lottery?.name)
          ? payments[0]?.lottery?.name
          : 'Multiple Lotteries')
      : 'Unknown';

  console.log(`Found  : ${payments.length} pending payment(s) → lottery: ${resolvedLotteryName}\n`);

  // 4. Build Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator  = 'Lottery SaaS';
  workbook.created  = new Date();
  workbook.modified = new Date();

  // ── Sheet 1: Payments Import ─────────────────────────────────────────
  const sheet = workbook.addWorksheet('Payments Import');

  sheet.columns = [
    { header: 'Buyer Name *',          key: 'name',      width: 28 },
    { header: 'Phone Number *',        key: 'phone',     width: 20 },
    { header: 'Ticket Numbers *',      key: 'tickets',   width: 36 },
    { header: 'Qty *',                 key: 'qty',       width:  8 },
    { header: 'Amount (ETB) *',        key: 'amount',    width: 16 },
    { header: 'Status *',              key: 'status',    width: 16 },
    { header: 'Email',                 key: 'email',     width:  0 },
    { header: 'Current Status',        key: 'curStatus', width:  0 },
    { header: 'Notes / Reject Reason', key: 'notes',     width:  0 },
  ];

  // Hide optional columns
  sheet.getColumn('email').hidden     = true;
  sheet.getColumn('curStatus').hidden = true;
  sheet.getColumn('notes').hidden     = true;

  // Row 1: column headers — required cols bold indigo, hidden cols grey
  const headerRow = sheet.getRow(1);
  headerRow.height    = 24;
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  ['name','phone','tickets','qty','amount','status'].forEach(k => {
    const cell = headerRow.getCell(sheet.getColumn(k).number);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
  });
  ['email','curStatus','notes'].forEach(k => {
    const cell = headerRow.getCell(sheet.getColumn(k).number);
    cell.font = { bold: false, color: { argb: 'FF6B7280' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
  });

  // Row 2: lottery context label
  const labelRow = sheet.addRow({
    name:      `Lottery: ${resolvedLotteryName}`,
    phone:     '',
    tickets:   `${payments.length} payment(s)`,
    qty:       '',
    amount:    '',
    status:    '',
    email:     '',
    curStatus: '',
    notes:     'Do NOT edit this row',
  });
  labelRow.height = 16;
  labelRow.eachCell(cell => {
    cell.font       = { italic: true, color: { argb: 'FF6B7280' }, size: 10 };
    cell.fill       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
    cell.protection = { locked: true };
  });

  // Rows 3+: real payment data
  payments.forEach((p, i) => {
    const plan       = STATUS_PLAN[i % STATUS_PLAN.length];
    const ticketNums = p.tickets.map(t => t.ticketNumber).join(', ');

    const row = sheet.addRow({
      name:      p.buyer?.name  ?? '—',
      phone:     p.buyer?.phone ?? '—',
      tickets:   ticketNums     || '—',
      qty:       p.tickets.length,
      amount:    Number(p.amount).toFixed(2),
      status:    plan.status,
      // hidden optional columns
      email:     p.buyer?.email ?? '',
      curStatus: p.status,
      notes:     plan.notes,
    });

    row.height = 20;

    // Zebra stripe on required visible columns
    const bg = i % 2 === 0 ? 'FF0D1117' : 'FF111827';
    ['name','phone','tickets','qty','amount'].forEach(k => {
      row.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    });

    // Ticket numbers — emerald green
    row.getCell('tickets').font  = { color: { argb: 'FF34D399' }, size: 11 };
    row.getCell('amount').numFmt = '#,##0.00';

    // Status — colour-coded + dropdown
    const statusCell = row.getCell('status');
    const bgS = plan.status === 'APPROVED' ? 'FF064E3B'
              : plan.status === 'REJECTED' ? 'FF450A0A'
              :                              'FF1F2937';
    const fgS = plan.status === 'APPROVED' ? 'FF34D399'
              : plan.status === 'REJECTED' ? 'FFF87171'
              :                              'FF6B7280';
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgS } };
    statusCell.font = { bold: true, color: { argb: fgS }, size: 11 };
    statusCell.dataValidation = {
      type:             'list',
      allowBlank:       false,
      formulae:         ['"APPROVED,PENDING"'],
      showErrorMessage: true,
      errorTitle:       'Invalid status',
      error:            'Choose APPROVED or PENDING',
      showInputMessage: true,
      promptTitle:      'Status',
      prompt:           'APPROVED = confirm & assign tickets  |  PENDING = no change',
    };

    // Lock read-only cells
    ['tickets','qty','curStatus'].forEach(k => {
      row.getCell(k).protection = { locked: true };
    });

    console.log(
      `  Row ${String(i + 1).padStart(2)}: ${(p.buyer?.name ?? '—').padEnd(22)}` +
      ` | ${p.buyer?.phone ?? '—'}` +
      ` | tickets: ${(ticketNums || '—').padEnd(16)}` +
      ` | ${plan.status}` +
      (plan.notes ? ` | "${plan.notes.slice(0, 55)}"` : ''),
    );
  });

  // Freeze header + label row; enable auto-filter on visible cols only
  sheet.views      = [{ state: 'frozen', ySplit: 2 }];
  sheet.autoFilter = { from: 'A1', to: 'F1' };

  // ── Sheet 2: Instructions ────────────────────────────────────────────
  const instr = workbook.addWorksheet('📋 Instructions');
  instr.getCell('A1').value = 'How to use this import template';
  instr.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FF818CF8' } };
  [
    ['Lottery',  resolvedLotteryName],
    ['Rows',     `${payments.length} real payment(s) from your database`],
    ['',         ''],
    ['Step 1',   'Open the "Payments Import" sheet.'],
    ['Step 2',   'For each row, click the "Status *" cell and choose from the dropdown:'],
    ['',         '  • APPROVED — confirms the payment and assigns the listed ticket(s)'],
    ['',         '  • REJECTED — rejects and releases those tickets back to the pool'],
    ['',         '  • PENDING  — no change (leave as-is)'],
    ['Step 3',   'Save and upload via "Import Excel" on the Payments page.'],
    ['',         ''],
    ['Required', 'Buyer Name * | Phone Number * | Ticket Numbers * | Qty * | Amount * | Status *'],
    ['Hidden',   'Email, Current Status, Notes — hidden by default, still stored in the file.'],
    ['Note 1',   'The backend matches each row to a payment using Phone Number.'],
    ['Note 2',   'Row 2 (grey) shows the lottery name — do not delete or edit it.'],
  ].forEach(([key, val], i) => {
    instr.getCell(`A${i + 3}`).value = key;
    instr.getCell(`B${i + 3}`).value = val;
    if (String(key).startsWith('Step'))    instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF34D399' } };
    if (String(key).startsWith('Note'))    instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FFFBBF24' } };
    if (String(key) === 'Required')        instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF818CF8' } };
    if (String(key) === 'Hidden')          instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF6B7280' } };
    if (String(key) === 'Lottery')         instr.getCell(`B${i + 3}`).font = { bold: true, color: { argb: 'FF818CF8' } };
  });
  instr.getColumn('A').width = 12;
  instr.getColumn('B').width = 82;

  // ── Write ────────────────────────────────────────────────────────────
  const outPath = path.join('/tmp', 'test-import.xlsx');
  await workbook.xlsx.writeFile(outPath);

  const approved = payments.filter((_, i) => STATUS_PLAN[i % STATUS_PLAN.length].status === 'APPROVED').length;
  const rejected = payments.filter((_, i) => STATUS_PLAN[i % STATUS_PLAN.length].status === 'REJECTED').length;
  const pending  = payments.filter((_, i) => STATUS_PLAN[i % STATUS_PLAN.length].status === 'PENDING').length;

  console.log(`\n✓  Written to ${outPath}`);
  console.log(`   Rows    : ${payments.length}   APPROVED: ${approved}   REJECTED: ${rejected}   PENDING: ${pending}`);
  console.log(`   Visible : Buyer Name * | Phone Number * | Ticket Numbers * | Qty * | Amount * | Status *`);
  console.log(`   Hidden  : Email, Current Status, Notes — hidden in Excel, still stored`);
  console.log(`   Import  : Upload via the "Import Excel" button on the Payments page`);
}

main()
  .catch(e => { console.error('\n✗ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
