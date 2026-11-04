const d = require("../db");
function record(
  user,
  action,
  entity_type,
  entity_id,
  old_values = null,
  new_values = null,
) {
  d.insert("audit_logs", {
    id: d.id(),
    user_id: user?.id || null,
    action,
    entity_type,
    entity_id: String(entity_id),
    old_values: old_values === null ? null : JSON.stringify(old_values),
    new_values: new_values === null ? null : JSON.stringify(new_values),
    ip_address: user?.ip || null,
  });
}
module.exports = {
  record,
  list: () =>
    d.all(
      "SELECT a.*,u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 2000",
    ),
};
