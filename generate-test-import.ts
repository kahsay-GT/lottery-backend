/**
 * Generates a ready-to-upload import Excel file with 10 sample payments.
 * Columns match the updated generateImportTemplate() layout:
 *   Reference Code | Buyer Name | Phone | Email | Lottery | Ticket Numbers | Qty | Amount (ETB) | Current Status | Action | Notes / Reject Reason
 *
 * Mode 1 (default) — reads real pending payments from the database.
 * Mode 2 (--mock)  — generates 10 fully hardcoded rows without a DB connection.
 *
 * Output: /tmp/test-import.xlsx
 *
 * Usage:
 *   npx ts-node generate-test-import.ts           # live DB
 *   npx ts-node generate-test-import.ts --mock    # no DB needed
 */
import ExcelJS = require('exceljs');

const MOCK_MODE = process.argv.includes('--mock');

// ── Hardcoded mock data (used when --mock flag is passed) ──────────────────
const MOCK_ROWS = [
  { referenceCode: 'REF-001-ABCD', buyerName: 'Abebe Girma',    phone: '+251911100001', email: 'abebe@mail.com',   lottery: 'Grand New Year Lottery', tickets: '1001, 1002',       qty: 2, amount: '1200.00', status: 'SUBMITTED',    action: 'APPROVE', notes: '' },
  { referenceCode: 'REF-002-EFGH', buyerName: 'Tigist Alemu',   phone: '+251911100002', email: '',                  lottery: 'Grand New Year Lottery', tickets: '1003',             qty: 1, amount: '600.00',  status: 'SUBMITTED',    action: 'APPROVE', notes: '' },
  { referenceCode: 'REF-003-IJKL', buyerName: 'Dawit Bekele',   phone: '+251911100003', email: 'dawit@mail.com',   lottery: 'Summer Mega Draw',       tickets: '2010, 2011, 2012', qty: 3, amount: '1500.00', status: 'UNDER_REVIEW', action: 'REJECT',  notes: 'Incorrect amount transferred — expected 1500 ETB, received 1200 ETB' },
  { referenceCode: 'REF-004-MNOP', buyerName: 'Selam Haile',    phone: '+251911100004', email: 'selam@mail.com',   lottery: 'Grand New Year Lottery', tickets: '1005',             qty: 1, amount: '600.00',  status: 'SUBMITTED',    action: 'APPROVE', notes: '' },
  { referenceCode: 'REF-005-QRST', buyerName: 'Yonas Tesfaye',  phone: '+251911100005', email: '',                  lottery: 'Summer Mega Draw',       tickets: '2015, 2016',       qty: 2, amount: '1000.00', status: 'SUBMITTED',    action: 'SKIP',    notes: '' },
  { referenceCode: 'REF-006-UVWX', buyerName: 'Hiwot Mekonen',  phone: '+251911100006', email: 'hiwot@mail.com',   lottery: 'Summer Mega Draw',       tickets: '2020',             qty: 1, amount: '500.00',  status: 'UNDER_REVIEW', action: 'REJECT',  notes: 'Slip is unreadable — please re-upload a clear photo' },
  { referenceCode: 'REF-007-YZAB', buyerName: 'Berhane Kebede', phone: '+251911100007', email: '',                  lottery: 'Grand New Year Lottery', tickets: '1010, 1011',       qty: 2, amount: '1200.00', status: 'SUBMITTED',    action: 'APPROVE', notes: '' },
  { referenceCode: 'REF-008-CDEF', buyerName: 'Meron Tadesse',  phone: '+251911100008', email: 'meron@mail.com',   lottery: 'Autumn Gold Raffle',     tickets: '3001',             qty: 1, amount: '800.00',  status: 'SUBMITTED',    action: 'SKIP',    notes: '' },
  { referenceCode: 'REF-009-GHIJ', buyerName: 'Solomon Desta',  phone: '+251911100009', email: '',                  lottery: 'Autumn Gold Raffle',     tickets: '3005, 3006, 3007', qty: 3, amount: '2400.00', status: 'UNDER_REVIEW', action: 'REJECT',  notes: 'Duplicate payment — already paid via reference REF-007-YZAB' },
  { referenceCode: 'REF-010-KLMN', buyerName: 'Fana Worku',     phone: '+251911100010', email: 'fana@mail.com',    lottery: 'Autumn Gold Raffle',     tickets: '3010',             qty: 1, amount: '800.00',  status: 'SUBMITTED',    action: 'APPROVE', notes: '' },
];

async function buildFromMock() {
  console.log('Running in MOCK mode — no database connection required.\n');
  return MOCK_ROWS;
}

async function buildFromDB() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const client = await prisma.client.findFirst({ where: { status: 'ACTIVE' } });
    if (!client) throw new Error('No active client found in the database.');

    const payments = await prisma.paymentTransaction.findMany({
      where: {
        clientId: client.id,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        deletedAt: null,
      },
      include: {
        buyer:   { select: { name: true, phone: true, email: true } },
        lottery: { select: { name: true } },
        tickets: { select: { ticketNumber: true }, orderBy: { ticketNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`Found ${payments.length} pending payment(s) for client "${client.name}".\n`);

    // Actions to assign: APPROVE ×5, REJECT ×3, SKIP ×2
    const actionPlan = [
      { action: 'APPROVE', notes: '' },
      { action: 'APPROVE', notes: '' },
      { action: 'REJECT',  notes: 'Incorrect amount transferred — expected the full ticket price' },
      { action: 'APPROVE', notes: '' },
      { action: 'SKIP',    notes: '' },
      { action: 'REJECT',  notes: 'Slip is unreadable — please re-upload a clear photo' },
      { action: 'APPROVE', notes: '' },
      { action: 'SKIP',    notes: '' },
      { action: 'REJECT',  notes: 'Duplicate payment — already paid via another reference' },
      { action: 'APPROVE', notes: '' },
    ];

    return payments.map((p, i) => {
      const { action, notes } = actionPlan[i] ?? { action: 'SKIP', notes: '' };
      const ticketNums = p.tickets.map((t: { ticketNumber: string }) => t.ticketNumber).join(', ');
      return {
        referenceCode: p.referenceCode,
        buyerName:     p.buyer?.name  ?? '—',
        phone:         p.buyer?.phone ?? '—',
        email:         p.buyer?.email ?? '',
        lottery:       (p.lottery as any)?.name ?? '—',
        tickets:       ticketNums || '—',
        qty:           p.tickets.length,
        amount:        Number(p.amount).toFixed(2),
        status:        p.status,
        action,
        notes,
      };
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const rows = MOCK_MODE ? await buildFromMock() : await buildFromDB();

  if (rows.length === 0) {
    console.warn('No rows to write. Exiting.');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator  = 'Lottery SaaS';
  workbook.created  = new Date();

  // ── Main import sheet ──────────────────────────────────────────────────
  const sheet = workbook.addWorksheet('Payments Import');
  sheet.columns = [
    { header: 'Reference Code',        key: 'referenceCode', width: 36 },
    { header: 'Buyer Name',            key: 'buyerName',     width: 28 },
    { header: 'Phone',                 key: 'phone',         width: 18 },
    { header: 'Email',                 key: 'email',         width: 30 },
    { header: 'Lottery',               key: 'lottery',       width: 28 },
    { header: 'Ticket Numbers',        key: 'tickets',       width: 36 },
    { header: 'Qty',                   key: 'qty',           width:  8 },
    { header: 'Amount (ETB)',          key: 'amount',        width: 14 },
    { header: 'Current Status',        key: 'status',        width: 16 },
    { header: 'Action',                key: 'action',        width: 14 },
    { header: 'Notes / Reject Reason', key: 'notes',         width: 50 },
  ];

  // Header style — deep indigo
  const headerRow = sheet.getRow(1);
  headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height    = 24;

  rows.forEach((p, i) => {
    const action = (p as any).action as string;
    const notes  = (p as any).notes  as string;

    const row = sheet.addRow({
      referenceCode: p.referenceCode,
      buyerName:     p.buyerName,
      phone:         p.phone,
      email:         (p as any).email ?? '—',
      lottery:       p.lottery,
      tickets:       (p as any).tickets ?? (p as any).ticket ?? '—',
      qty:           (p as any).qty ?? 1,
      amount:        p.amount,
      status:        p.status,
      action,
      notes,
    });

    row.height = 20;

    // Reference code — purple bold
    row.getCell('referenceCode').font = { bold: true, color: { argb: 'FF818CF8' } };

    // Ticket numbers — green
    row.getCell('tickets').font = { color: { argb: 'FF34D399' } };

    // Amount — number format
    row.getCell('amount').numFmt = '#,##0.00';

    // Zebra stripe
    const bg = i % 2 === 0 ? 'FF0D1117' : 'FF111827';
    ['referenceCode','buyerName','phone','email','lottery','tickets','qty','amount','status','notes'].forEach(k => {
      row.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    });

    // Action cell colour
    const actionCell = row.getCell('action');
    const bgColour   = action === 'APPROVE' ? 'FF064E3B' : action === 'REJECT' ? 'FF450A0A' : 'FF1F2937';
    const fgColour   = action === 'APPROVE' ? 'FF34D399' : action === 'REJECT' ? 'FFF87171' : 'FF6B7280';
    actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColour } };
    actionCell.font = { bold: true, color: { argb: fgColour } };

    // Dropdown validation on Action cell
    (actionCell as any).dataValidation = {
      type:             'list',
      allowBlank:       false,
      formulae:         ['"APPROVE,REJECT,SKIP"'],
      showErrorMessage: true,
      errorTitle:       'Invalid action',
      error:            'Choose APPROVE, REJECT, or SKIP',
    };

    console.log(
      `  Row ${String(i + 1).padStart(2)}: ${p.referenceCode}` +
      ` | ${p.buyerName.padEnd(18)}` +
      ` | tickets: ${String((p as any).tickets ?? '—').padEnd(16)}` +
      ` | ${action}` +
      (notes ? ` | "${notes}"` : ''),
    );
  });

  sheet.views      = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'K1' };

  // ── Instructions sheet ─────────────────────────────────────────────────
  const instr = workbook.addWorksheet('📋 Instructions');
  instr.getCell('A1').value = 'How to use this import template';
  instr.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FF818CF8' } };
  [
    ['Step 1', 'Open the "Payments Import" sheet.'],
    ['Step 2', 'For each payment, set the "Action" column to:'],
    ['',       '  • APPROVE — approves the payment and confirms the listed tickets to the buyer'],
    ['',       '  • REJECT  — rejects the payment and releases those tickets back to the pool'],
    ['',       '  • SKIP    — leave this payment unchanged (default)'],
    ['Step 3', 'Optionally fill "Notes / Reject Reason" — required when Action = REJECT.'],
    ['Step 4', 'Save and upload the file via the "Import Excel" button on the Payments page.'],
    ['Note 1', 'Do NOT change Reference Code, Ticket Numbers, Qty, or Status — they are read-only.'],
    ['Note 2', 'If no reference code exists, matching falls back to the Phone column.'],
    ['Note 3', 'The "Ticket Numbers" column shows which tickets are reserved for each payment.'],
  ].forEach(([key, val], i) => {
    instr.getCell(`A${i + 3}`).value = key;
    instr.getCell(`B${i + 3}`).value = val;
    if ((key as string).startsWith('Step')) {
      instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF34D399' } };
    } else if ((key as string).startsWith('Note')) {
      instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FFFBBF24' } };
    }
  });
  instr.getColumn('A').width = 10;
  instr.getColumn('B').width = 80;

  // ── Write file ─────────────────────────────────────────────────────────
  const outPath = '/tmp/test-import.xlsx';
  await workbook.xlsx.writeFile(outPath);

  const approveCount = rows.filter(r => (r as any).action === 'APPROVE').length;
  const rejectCount  = rows.filter(r => (r as any).action === 'REJECT').length;
  const skipCount    = rows.filter(r => (r as any).action === 'SKIP').length;

  console.log(`\n✓ Written to ${outPath}`);
  console.log(`  Summary: APPROVE=${approveCount}, REJECT=${rejectCount}, SKIP=${skipCount}, TOTAL=${rows.length}`);
  console.log(`  Columns: Reference Code | Buyer Name | Phone | Email | Lottery | Ticket Numbers | Qty | Amount | Status | Action | Notes`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
