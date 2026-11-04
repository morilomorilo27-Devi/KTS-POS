const d = require("../db");
const audit = require("./auditService");
function current(user) {
  return (
    d.get(
      "SELECT * FROM cashier_shifts WHERE user_id=? AND status='open'",
      user.id,
    ) || null
  );
}
function requireShift(user, id) {
  const s = current(user);
  if (!s || (id && s.id !== id))
    d.fail("يلزم وجود وردية مفتوحة تخص المستخدم الحالي");
  return s;
}
function open(user, body) {
  return d.transaction(() => {
    if (current(user)) d.fail("توجد وردية مفتوحة بالفعل");
    const cash = d.money(d.number(body.opening_cash, "رصيد الافتتاح"));
    const s = d.insert("cashier_shifts", {
      id: d.id(),
      shift_no: d.get(
        "SELECT COALESCE(MAX(shift_no),0)+1 n FROM cashier_shifts",
      ).n,
      user_id: user.id,
      opening_cash: cash,
      expected_cash: cash,
      notes: body.notes || null,
    });
    audit.record(user, "shift_open", "cashier_shifts", s.id, null, s);
    return current(user);
  });
}
function cashRefunds(shiftId) {
  return d.money(
    d.get(
      "SELECT COALESCE(SUM(p.amount),0) n FROM return_refund_payments p JOIN return_transactions r ON r.id=p.return_id WHERE r.shift_id=? AND p.payment_method='cash'",
      shiftId,
    ).n,
  );
}
function close(user, body) {
  return d.transaction(() => {
    const s = requireShift(user);
    if (d.get("SELECT COUNT(*) n FROM held_carts WHERE shift_id=?", s.id).n)
      d.fail("استرجع السلات المعلقة قبل إغلاق الوردية");
    const outflows = d.get(
      "SELECT COALESCE(SUM(amount),0) n FROM shift_cash_movements WHERE shift_id=?",
      s.id,
    ).n;
    const expected = d.money(
      s.opening_cash + s.total_cash_sales - cashRefunds(s.id) - outflows,
    );
    const actual = d.money(d.number(body.actual_cash, "النقد الفعلي"));
    d.run(
      "UPDATE cashier_shifts SET expected_cash=?,actual_cash=?,discrepancy=?,status='closed',closed_at=datetime('now'),notes=? WHERE id=?",
      expected,
      actual,
      d.money(actual - expected),
      body.notes || s.notes,
      s.id,
    );
    const updated = d.get("SELECT * FROM cashier_shifts WHERE id=?", s.id);
    audit.record(user, "shift_close", "cashier_shifts", s.id, s, updated);
    return { success: true, ...updated, cash_outflows: outflows };
  });
}
function schedules() {
  return d.all(
    "SELECT s.*,u.full_name FROM cashier_shift_schedules s JOIN users u ON u.id=s.user_id ORDER BY user_id,day_of_week",
  );
}
function saveSchedule(user, body) {
  const day = d.number(body.day_of_week, "اليوم");
  if (!Number.isInteger(day) || day > 6) d.fail("اليوم غير صالح");
  if (!["morning", "evening", "full"].includes(body.shift_type))
    d.fail("الفترة غير صالحة");
  const defaults = {
    morning: ["08:00", "15:00"],
    evening: ["15:00", "22:00"],
    full: ["08:00", "22:00"],
  };
  const data = {
    user_id: body.user_id,
    day_of_week: day,
    shift_type: body.shift_type,
    start_time: body.start_time || defaults[body.shift_type][0],
    end_time: body.end_time || defaults[body.shift_type][1],
    is_active: Number(body.is_active ?? 1),
    notes: body.notes || null,
  };
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.start_time) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.end_time) ||
    data.start_time >= data.end_time
  )
    d.fail("وقت غير صالح");
  return d.transaction(() => {
    const row = body.id
      ? d.update("cashier_shift_schedules", body.id, data)
      : d.insert("cashier_shift_schedules", { id: d.id(), ...data });
    audit.record(
      user,
      "schedule_save",
      "cashier_shift_schedules",
      row.id,
      null,
      row,
    );
    return row;
  });
}
module.exports = {
  current,
  requireShift,
  open,
  close,
  cashRefunds,
  schedules,
  saveSchedule,
};
