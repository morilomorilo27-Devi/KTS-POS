const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "C:/Users/OMAR1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kts-browser-"));
process.env.KTS_DB_PATH = path.join(directory, "test.db");
const app = require("../server/src/app");
const db = require("../server/src/db");
let browser, server;
(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  }).then((r) => r.json());
  const api = async (url, body) =>
    fetch(base + "/api" + url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + login.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  for (let i = 0; i < 55; i++)
    await api("/products", {
      sku: "NB-" + i,
      name_ar: "دفتر مدرسي A4 — " + (i + 1),
      name_en: "School Notebook",
      category_id: "cat-" + ((i % 5) + 1),
      sale_price: 1.25,
      cost_price: 0.5,
      initial_qty: 150,
      barcodes: ["6281000" + i],
    });
  await api("/members", {
    membership_no: "KTS-M001",
    civil_id: "285010101234",
    name: "عضو اختبار الواجهة",
    category_id: "mcat-1",
    phone: "99887766",
  });
  await api("/suppliers", {
    code: "SUP-UI",
    name: "مورد اختبار الواجهة",
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  const manifest = await page.evaluate(async () =>
    fetch("/manifest.webmanifest").then((response) => response.json()),
  );
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.dir, "rtl");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute("href"),
    "manifest.webmanifest",
  );
  await page.locator("[name=username]").fill("admin");
  await page.locator("[name=password]").fill("admin123");
  await page.locator("#loginForm button").click();
  await page.locator("#appShell").waitFor({ state: "visible" });
  await page.locator(".product-card").first().waitFor();
  assert.equal(await page.locator(".product-card").count(), 55);
  await page.locator("body.pos-mode").waitFor();
  assert.equal(await page.locator("body.pos-mode").count(), 1);
  const commandHeight = await page
    .locator(".product-command")
    .evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(commandHeight >= 52 && commandHeight <= 58);
  assert.notEqual(await page.locator("#operationsClock").innerText(), "--:--");
  assert.equal(
    await page.locator("#transactionGuideShortcut").innerText(),
    "F2",
  );
  assert.equal(
    await page
      .locator('.transaction-progress [data-step="product"]')
      .getAttribute("aria-current"),
    "step",
  );
  fs.mkdirSync(path.join(__dirname, "test-output"), { recursive: true });
  await page.screenshot({
    path: path.join(__dirname, "test-output/pos-empty-1366.png"),
  });
  // Slow catalog requests must never reveal the POS before its mode styles apply.
  let releaseSnapshot;
  const snapshotHeld = new Promise((resolve) => { releaseSnapshot = resolve; });
  await page.route("**/api/sync/snapshot", async (route) => {
    await snapshotHeld;
    await route.continue();
  }, { times: 1 });
  try {
    await Promise.all([
      page.waitForRequest("**/api/sync/snapshot", { timeout: 5000 }),
      page.reload({ waitUntil: "domcontentloaded" }),
    ]);
    assert.equal(await page.locator("#appShell").isVisible(), false);
    assert.equal(await page.locator("#loginScreen").isVisible(), false);
    assert.equal(await page.locator("#sessionLoading").isVisible(), true);
  } finally {
    releaseSnapshot();
  }
  await page.locator("body.pos-mode #appShell").waitFor({ state: "visible" });
  await page.locator("#sessionLoading").waitFor({ state: "hidden" });
  await page.locator("[data-view=admin]").click();
  await page.locator(".dashboard-metrics").waitFor();
  assert.equal(await page.locator(".chart-empty").count(), 1);
  await page.screenshot({ path: "docs/test-output/admin-empty-dashboard.png" });
  await page.locator("[data-view=pos]").click();
  await page.locator("#shiftButton").click();
  await page.locator("#shiftForm [name=amount]").fill("50");
  await page.locator("#shiftForm .primary").click();
  await page.locator("#generalModal").waitFor({ state: "hidden" });
  await page.keyboard.press("F2");
  await page.locator("#posSearchInput").fill("دفتر");
  await page.waitForFunction(() => POS.searchMatches.length > 0);
  await page.locator("#posSearchInput").evaluate((input) => {
    input.value = "9999999999999";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.equal(await page.evaluate(() => POS.cart.length), 0);
  assert.equal(await page.locator(".transaction-heading").getAttribute("data-state"), "error");
  await page.locator("#posSearchInput").fill("62810000");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => POS.cart.length === 1 && POS.totals.net_total === 1.25,
  );
  assert.ok(
    (await page.locator("#transactionGuideTitle").innerText()).includes(
      "تمت إضافة",
    ),
  );
  assert.equal(await page.locator(".cart-row.recently-added").count(), 1);
  assert.match(await page.locator("#transactionGuideDetail").innerText(), /إجمالي الطلب:.*1\.250/);
  assert.equal(await page.evaluate(() => document.activeElement.id), "posSearchInput");
  await page.locator('#cartItems [data-delta="1"]').click();
  await page.waitForFunction(() => POS.totals.net_total === 2.5);
  await page.keyboard.press("F8");
  await page.locator("#memberSearchInput").fill("KTS-M001");
  await page.locator("#memberForm button").click();
  await page.locator("#memberDiscountModal").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(__dirname, "test-output/pos-member-discount.png"),
  });
  await page.locator('#discountOptions [value="disc-1"]').check();
  await page.locator("#discountForm .primary").click();
  await page.waitForFunction(() => POS.totals.net_total === 2.125);
  await page.locator("[data-payment=split]").click();
  await page.locator("#splitCash").fill(".5");
  await page.locator("#splitCash").dispatchEvent("input");
  assert.equal(await page.locator("#splitKnet").inputValue(), "1.625");
  assert.ok(
    (await page.locator(".payment-heading small").innerText()).includes(
      "دفع مقسّم",
    ),
  );
  assert.equal(await page.locator("#splitStatus.balanced").count(), 1);
  assert.equal(
    await page
      .locator('.transaction-progress [data-step="payment"]')
      .getAttribute("aria-current"),
    "step",
  );
  for (const [width, height] of [
    [1366, 768],
    [1600, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: path.join(__dirname, `test-output/pos-${width}.png`),
    });
    const measurements = await page.evaluate(() => {
      const checkout = document
        .getElementById("checkoutButton")
        .getBoundingClientRect();
      const rail = document
        .querySelector(".transaction-rail")
        .getBoundingClientRect();
      const cols = getComputedStyle(
        document.getElementById("productGrid"),
      ).gridTemplateColumns.split(" ").length;
      return {
        bottom: checkout.bottom,
        height: innerHeight,
        rail: rail.width,
        cols,
        overflow: document.documentElement.scrollWidth > innerWidth,
        rtlLayout: document.querySelector(".catalog").getBoundingClientRect().left >= rail.right - 1,
      };
    });
    assert.ok(measurements.bottom <= height, JSON.stringify(measurements));
    assert.equal(measurements.overflow, false);
    assert.equal(measurements.rtlLayout, true);
    console.log("Viewport", width, measurements);
  }
  await page.keyboard.press("F10");
  await page.locator("#receiptModal").waitFor({ state: "visible" });
  assert.ok(
    (await page.locator("#receiptPaper").innerText()).includes("2.125"),
  );
  assert.ok(
    (await page.locator("#receiptPaper").innerText()).includes("1.625"),
  );
  await page.emulateMedia({ media: "print" });
  const printWidth = await page
    .locator("#receiptPaper")
    .evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(printWidth > 300 && printWidth < 305);
  assert.ok(
    (await page
      .locator("#receiptPaper .barcode")
      .evaluate((el) => el.getBoundingClientRect().width)) > 250,
  );
  await page
    .locator("#receiptPaper")
    .screenshot({ path: path.join(__dirname, "test-output/receipt-80mm.png") });
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  assert.equal(db.get("SELECT COUNT(*) n FROM sales").n, 1);
  await page.waitForFunction(() => !POS.busy);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(async () => {
    POS.cart = POS.products
      .slice(0, 50)
      .map((p) => ({ product_id: p.id, qty: 1 }));
    await POS.calculate();
  });
  assert.equal(await page.locator(".cart-row").count(), 50);
  const cartLayout = await page.evaluate(() => ({
    cartScroll:
      document.getElementById("cartItems").scrollHeight >
      document.getElementById("cartItems").clientHeight,
    checkoutBottom: document
      .getElementById("checkoutButton")
      .getBoundingClientRect().bottom,
  }));
  assert.equal(cartLayout.cartScroll, true);
  assert.ok(cartLayout.checkoutBottom <= 768);
  assert.equal(await page.locator("#checkoutButton").isEnabled(), true);
  await page.screenshot({
    path: path.join(__dirname, "test-output/pos-cart-50.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(__dirname, "test-output/pos-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => POS.clear());
  await page.locator("[data-view=admin]").click();
  await page.locator(".dashboard-metrics").waitFor();
  assert.equal(
    await page.locator("#adminSidebar [data-section] svg").count(),
    28,
  );
  for (const width of [1366, 1920, 768, 390]) {
    await page.setViewportSize({ width, height: width > 1400 ? 1080 : 844 });
    await page.screenshot({
      path: `docs/test-output/admin-dashboard-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Admin overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const section of [
    "exceptions",
    "products",
    "categories",
    "reorder",
    "procurement-requests",
    "purchase-orders",
    "supplier-invoices",
    "cycle-counts",
    "members",
    "member-benefits",
    "discounts",
    "suppliers",
    "purchases",
    "inventory",
    "movements",
    "shifts",
    "schedules",
    "accounting",
    "journal",
    "audit",
    "users",
    "reports",
    "import",
    "settings",
    "customer-display",
    "devices",
    "backups",
  ]) {
    await page.locator(`[data-section=${section}]`).click();
    await page.waitForFunction(
      () => !document.querySelector("#adminContent .skeleton"),
    );
    assert.equal(
      await page.locator("#retryAdmin").count(),
      0,
      "admin " + section,
    );
    await page.screenshot({ path: `docs/test-output/admin-${section}.png` });
    if (section === "products") {
      await page.locator("#adminSearch").fill("NB-54");
      assert.equal(await page.locator("#adminContent tbody tr").count(), 1);
      await page.locator("#adminSearch").fill("");
      assert.equal(await page.locator("#adminContent tbody tr").count(), 20);
      await page.locator("#adminNext").click();
      await page.locator("#adminNext").click();
      assert.equal(await page.locator("#adminContent tbody tr").count(), 15);
      await page.locator("#adminPrevious").click();
      await page.locator("#adminToolbar .primary").click();
      await page.locator("#entityForm").waitFor();
      assert.equal(await page.locator('[name="min_price"]').count(), 0);
      assert.equal(await page.locator('[name="image_url"]').count(), 0);
      assert.equal(await page.locator('[name="image"][required]').count(), 0);
      await page.locator(".supplier-picker summary").click();
      assert.equal(await page.locator(".supplier-picker input").count(), 1);
      await page.locator(".supplier-picker input").check();
      assert.equal(
        await page.locator(".supplier-selection-text").textContent(),
        "1 مورد محدد",
      );
      await page.screenshot({
        path: "docs/test-output/admin-product-form.png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page
          .locator("#generalModal")
          .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
      );
      await page.locator("#entityForm .primary").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "docs/test-output/admin-product-form-mobile.png",
      });
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.keyboard.press("Escape");
    }
    if (section === "inventory") {
      await page.locator("#adminSearch").fill("NB");
      await page.locator("#adminSearch").fill("NB-");
      assert.equal(await page.locator("[data-damaged]").count(), 1);
    }
    if (section === "settings") {
      await page
        .locator("#settingsForm [name=branch_name]")
        .fill("معاينة الفرع");
      assert.equal(
        await page.locator("#branchPreview h3").innerText(),
        "معاينة الفرع",
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Section overflow: ${section}`,
    );
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  await page.locator("[data-section=schedules]").click();
  await page.waitForFunction(
    () => !document.querySelector("#adminContent .skeleton"),
  );
  await page.locator("#adminToolbar .primary").click();
  await page.locator("#entityForm").waitFor();
  await page.locator("#entityForm [name=shift_type]").selectOption("evening");
  assert.equal(
    await page.locator("#entityForm [name=start_time]").inputValue(),
    "15:00",
  );
  await page.locator("#entityForm .primary").click();
  await page.locator("#generalModal").waitFor({ state: "hidden" });
  await page.locator("[data-view=pos]").click();
  await page.locator(".product-card").first().click();
  await page.waitForFunction(
    () => POS.cart.length === 1 && POS.totals.net_total > 0,
  );
  await page.keyboard.press("F4");
  await page.waitForFunction(() => POS.cart.length === 0);
  await page.keyboard.press("F9");
  await page.locator("[data-cart]").click();
  await page.waitForFunction(() => POS.cart.length === 1);
  await page.locator("#cartItems [data-remove]").click();
  await page.waitForFunction(() => POS.cart.length === 0);
  // A populated local catalogue and active shift permit queued sales during outages.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.evaluate(() => API.status(false));
  await page.locator(".product-card").first().click();
  await page.waitForFunction(() => POS.totals.net_total > 0);
  await page.keyboard.press("F4");
  await page.waitForFunction(() => POS.cart.length === 0);
  await page.keyboard.press("F9");
  await page.locator("[data-cart]").click();
  await page.waitForFunction(() => POS.cart.length === 1);
  await page.locator("[data-payment=cash]").click();
  await page.locator("#checkoutButton").click();
  await page.locator("#receiptModal").waitFor({ state: "visible" });
  assert.ok(
    (await page.locator("#receiptPaper").innerText()).includes("مؤجلة"),
  );
  assert.equal(
    await page.evaluate(async () => (await Offline.pending()).length),
    1,
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator("#appShell").waitFor({ state: "visible" });
  assert.equal(await page.locator(".product-card").count(), 55);
  await context.setOffline(false);
  await page.evaluate(() => POS.sync(true));
  await page.waitForFunction(
    async () => (await Offline.pending()).length === 0,
  );
  assert.equal(db.get("SELECT COUNT(*) n FROM sales").n, 2);
  await page.evaluate(() => POS.sync());
  assert.equal(db.get("SELECT COUNT(*) n FROM sales").n, 2);
  assert.deepEqual(errors, []);
  console.log(
    "Browser flow PASS: POS regression, procurement and operations UI, multi-supplier product form, installable PWA manifest, 28 admin sections, search, pagination, forms, 4 admin widths, offline reload and replay",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    db.db.close();
    if (
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith("kts-browser-")
    )
      fs.rmSync(directory, { recursive: true, force: true });
  });
