const d = require("../db");
// Internal accounting extension authorized by the user; original POS tables remain intact.
d.db
  .exec(`CREATE TABLE IF NOT EXISTS accounting_accounts(code TEXT PRIMARY KEY,name_ar TEXT NOT NULL,type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal_entries(id TEXT PRIMARY KEY,entry_no TEXT UNIQUE NOT NULL,reference_type TEXT NOT NULL,reference_id TEXT NOT NULL,description TEXT NOT NULL,user_id TEXT REFERENCES users(id),created_at TEXT DEFAULT(datetime('now')),UNIQUE(reference_type,reference_id));
CREATE TABLE IF NOT EXISTS journal_lines(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES journal_entries(id),account_code TEXT NOT NULL REFERENCES accounting_accounts(code),debit REAL NOT NULL DEFAULT 0 CHECK(debit>=0),credit REAL NOT NULL DEFAULT 0 CHECK(credit>=0));
CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,purchase_no TEXT UNIQUE NOT NULL,supplier_id TEXT NOT NULL REFERENCES suppliers(id),total REAL NOT NULL,paid_amount REAL NOT NULL,payment_method TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),notes TEXT,created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS purchase_lines(id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchases(id),product_id TEXT NOT NULL REFERENCES products(id),qty REAL NOT NULL,unit_cost REAL NOT NULL,line_total REAL NOT NULL);
CREATE TABLE IF NOT EXISTS supplier_payments(id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL REFERENCES suppliers(id),amount REAL NOT NULL,payment_method TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),notes TEXT,created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS sale_cost_lines(sale_line_id TEXT PRIMARY KEY REFERENCES sale_lines(id),unit_cost REAL NOT NULL);
CREATE TABLE IF NOT EXISTS shift_cash_movements(id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES cashier_shifts(id),amount REAL NOT NULL,reference_type TEXT NOT NULL,reference_id TEXT NOT NULL,created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS return_refund_payments(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES return_transactions(id),payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','knet')),amount REAL NOT NULL CHECK(amount>=0));
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created ON journal_entries(created_at);
CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT,'Journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT,'Journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_line_no_delete BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT,'Journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_line_no_update BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT,'Journal lines are immutable'); END;`);
for (const a of [
  ["1100", "النقدية", "asset"],
  ["1110", "تحصيل كي نت", "asset"],
  ["1200", "مخزون البضاعة", "asset"],
  ["2100", "ذمم الموردين", "liability"],
  ["3100", "رصيد افتتاحي", "equity"],
  ["4100", "إيرادات المبيعات", "income"],
  ["4200", "مردودات المبيعات", "contra_income"],
  ["5100", "تكلفة البضاعة المباعة", "expense"],
  ["5200", "تلف وتسويات مخزون", "expense"],
])
  d.run("INSERT OR IGNORE INTO accounting_accounts VALUES(?,?,?)", ...a);
function post(user, type, ref, description, lines) {
  const existing = d.get(
    "SELECT * FROM journal_entries WHERE reference_type=? AND reference_id=?",
    type,
    ref,
  );
  if (existing) return existing;
  lines = lines
    .map((l) => ({
      ...l,
      debit: d.money(l.debit || 0),
      credit: d.money(l.credit || 0),
    }))
    .filter((l) => l.debit || l.credit);
  if (d.money(lines.reduce((s, l) => s + l.debit - l.credit, 0)) !== 0)
    d.fail("القيد المحاسبي غير متوازن");
  const row = d.insert("journal_entries", {
    id: d.id(),
    entry_no: d.sequence("journal_entries", "entry_no", "JRN"),
    reference_type: type,
    reference_id: ref,
    description,
    user_id: user.id,
  });
  for (const l of lines)
    d.insert("journal_lines", {
      id: d.id(),
      entry_id: row.id,
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
    });
  return row;
}
function sale(user, sale, payments, cost) {
  const cash =
    payments
      .filter((p) => p.payment_method === "cash")
      .reduce((s, p) => s + p.amount, 0) - sale.change_due;
  const knet = payments
    .filter((p) => p.payment_method === "knet")
    .reduce((s, p) => s + p.amount, 0);
  post(user, "sale", sale.id, sale.invoice_no, [
    { account_code: "1100", debit: cash },
    { account_code: "1110", debit: knet },
    { account_code: "4100", credit: sale.net_total },
    { account_code: "5100", debit: cost },
    { account_code: "1200", credit: cost },
  ]);
}
function balances() {
  return d.all(
    "SELECT a.*,COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit,ROUND(COALESCE(SUM(l.debit-l.credit),0),3) balance FROM accounting_accounts a LEFT JOIN journal_lines l ON l.account_code=a.code GROUP BY a.code ORDER BY a.code",
  );
}
function entries({ page = 1, limit = 50 } = {}) {
  page = Math.max(1, Math.floor(Number(page) || 1));
  limit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
  const rows = d
    .all(
      "SELECT e.*,u.full_name FROM journal_entries e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.created_at DESC,e.rowid DESC LIMIT ? OFFSET ?",
      limit, (page - 1) * limit,
    )
    .map((e) => ({
      ...e,
      lines: d.all(
        "SELECT l.*,a.name_ar FROM journal_lines l JOIN accounting_accounts a ON a.code=l.account_code WHERE entry_id=?",
        e.id,
      ),
    }));
  return { rows, page, limit, total: d.get("SELECT COUNT(*) n FROM journal_entries").n };
}
function drawerOutflow(user, amount, type, ref) {
  const shift = d.get(
    "SELECT id FROM cashier_shifts WHERE user_id=? AND status='open'",
    user.id,
  );
  if (shift && amount > 0) {
    d.insert("shift_cash_movements", {
      id: d.id(),
      shift_id: shift.id,
      amount,
      reference_type: type,
      reference_id: ref,
    });
    d.run(
      "UPDATE cashier_shifts SET expected_cash=ROUND(expected_cash-?,3) WHERE id=?",
      amount,
      shift.id,
    );
  }
}
module.exports = { post, sale, balances, entries, drawerOutflow };
