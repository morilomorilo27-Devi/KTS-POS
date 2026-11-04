const d = require("../db");
const products = require("./productService");
const categories = require("./categoryService");
const members = require("./memberService");
const pos = require("./posService");
function snapshot(user) {
  return {
    timestamp: new Date().toISOString(),
    products: products.list({ limit: 100000 }),
    categories: categories.list(),
    members: user.permissions.includes("pos_member_lookup") ? members.searchPos() : [],
    membership_categories: members.categories(),
    rules: user.permissions.includes("pos_discount") ? d.all("SELECT * FROM discount_rules WHERE status='active'") : [],
    membership_product_prices: d.all(
      `SELECT * FROM membership_product_prices
       WHERE (starts_at IS NULL OR starts_at<=date('now'))
       AND (ends_at IS NULL OR ends_at>=date('now'))`,
    ),
    member_profiles: d.all("SELECT * FROM member_profiles"),
    member_wallets: d.all("SELECT * FROM member_wallets"),
    member_vouchers: d.all(
      `SELECT * FROM member_vouchers WHERE status='active'
       AND (starts_at IS NULL OR starts_at<=date('now'))
       AND (expires_at IS NULL OR expires_at>=date('now'))`,
    ),
    shift: require("./shiftService").current(user),
  };
}
function upload(user, body) {
  if (!Array.isArray(body.transactions) || body.transactions.length > 100)
    d.fail("دفعة المزامنة غير صالحة");
  return {
    results: body.transactions.map((t) => {
      try {
        return {
          client_transaction_id: t.client_transaction_id,
          ...pos.checkout(user, t),
        };
      } catch (e) {
        return {
          client_transaction_id: t.client_transaction_id,
          success: false,
          error: e.message,
        };
      }
    }),
  };
}
module.exports = { snapshot, upload };
