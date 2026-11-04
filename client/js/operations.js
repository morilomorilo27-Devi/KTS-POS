/* Advanced operational modules: procurement, cycle counts, exceptions, devices and recovery. */
(function () {
  const customSections = new Map([
    ["exceptions", "exceptionsPage"],
    ["reorder", "reorderPage"],
    ["procurement-requests", "procurementPage"],
    ["purchase-orders", "purchaseOrdersPage"],
    ["supplier-invoices", "supplierInvoicesPage"],
    ["cycle-counts", "cycleCountsPage"],
    ["member-benefits", "memberBenefitsPage"],
    ["devices", "devicesPage"],
    ["backups", "backupsPage"],
  ]);

  const stateLabel = (value) =>
    ({
      draft: "مسودة",
      approved: "معتمد",
      ordered: "تم الطلب",
      cancelled: "ملغي",
      received: "مستلم",
      selected: "مختار",
      rejected: "مرفوض",
      expired: "منتهي",
      sent: "مرسل",
      partial: "استلام جزئي",
      pending: "بانتظار المطابقة",
      matched: "مطابق",
      variance: "به فروقات",
      partially_paid: "مسدد جزئيًا",
      paid: "مسدد",
      open: "مفتوح",
      completed: "مكتمل",
      valid: "سليمة",
      invalid: "غير سليمة",
      active: "فعال",
      inactive: "غير فعال",
      error: "خطأ",
    })[value] || value;

  const badge = (value) =>
    `<span class="status-badge status-${UI.escape(value)}"><i></i>${UI.escape(stateLabel(value))}</span>`;

  const empty = (title, text) =>
    `<div class="empty-state operations-empty">${AdminDesign.icon("inventory")}<strong>${title}</strong><p>${text}</p></div>`;

  function activate(section) {
    Admin.section = section;
    Admin.tablePage = 1;
    for (const button of UI.$("adminSidebar").querySelectorAll("[data-section]")) {
      button.classList.toggle("active", button.dataset.section === section);
      if (button.dataset.section === section) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const item = Admin.sections.find((entry) => entry[0] === section);
    UI.$("adminHeading").innerHTML = AdminDesign.heading(section, item[1]);
    UI.$("adminToolbar").innerHTML = "";
    UI.$("adminContent").dataset.adminSection = section;
    UI.$("adminContent").innerHTML =
      '<div class="skeleton" aria-label="جارٍ تحميل البيانات"></div>';
  }

  function finish(section) {
    if (Admin.section !== section) return;
    AdminDesign.decorate();
    const refresh = UI.$("adminRefresh");
    if (refresh) refresh.onclick = () => Admin.load(section);
  }

  const previousLoad = Admin.load;
  Admin.load = async function (section) {
    const method = customSections.get(section);
    if (!method) return previousLoad.call(this, section);
    const item = this.sections.find((entry) => entry[0] === section);
    if (!item || !Auth.can(item[2])) return;
    activate(section);
    try {
      await this[method]();
      finish(section);
    } catch (error) {
      if (this.section !== section) return;
      UI.$("adminContent").innerHTML =
        `<div class="empty-state"><strong>تعذر تحميل البيانات</strong><p>${UI.escape(error.message)}</p><button id="retryAdmin">إعادة المحاولة</button></div>`;
      UI.$("retryAdmin").onclick = () => this.load(section);
    }
  };

  Admin.exceptionsPage = async function () {
    const data = await API.request("/exceptions");
    const pending = await Offline.pending().catch(() => []);
    if (pending.length)
      data.alerts.unshift({
        type: "offline_pending",
        severity: "critical",
        title: "فواتير محفوظة محليًا تنتظر المزامنة",
        description: "افتح شاشة الكاشير ونفّذ المزامنة بعد التأكد من الاتصال.",
        count: pending.length,
        action: "pos",
        rows: pending.slice(0, 10),
      });
    const critical = data.alerts
      .filter((alert) => alert.severity === "critical")
      .reduce((sum, alert) => sum + alert.count, 0);
    UI.$("adminToolbar").innerHTML = `<span class="operations-generated">آخر فحص: ${new Intl.DateTimeFormat("ar-KW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.generated_at))}</span>`;
    UI.$("adminContent").innerHTML = `
      <div class="metrics operations-metrics">
        ${AdminDesign.metric("إجمالي الاستثناءات", data.alerts.reduce((s, a) => s + a.count, 0), "exceptions", "تحتاج إلى مراجعة", "amber")}
        ${AdminDesign.metric("حرجة", critical, "alert", "تحتاج إجراءً سريعًا", "violet")}
        ${AdminDesign.metric("أنواع التنبيهات", data.alerts.length, "reports", "مصنفة حسب السبب", "blue")}
      </div>
      <div class="exception-grid">${
        data.alerts.length
          ? data.alerts
              .map(
                (alert) => `<article class="exception-card severity-${alert.severity}">
                <div class="exception-head"><i>${AdminDesign.icon("alert")}</i><div><span>${alert.count} حالة</span><h2>${UI.escape(alert.title)}</h2></div></div>
                <p>${UI.escape(alert.description)}</p>
                <button data-alert-action="${UI.escape(alert.action)}">فتح الإجراء ${AdminDesign.icon("arrow")}</button>
              </article>`,
              )
              .join("")
          : empty("لا توجد استثناءات", "البيانات التشغيلية سليمة ولا يوجد ما يحتاج إلى تدخل الآن.")
      }</div>`;
    for (const button of document.querySelectorAll("[data-alert-action]"))
      button.onclick = () => {
        const action = button.dataset.alertAction;
        if (action === "pos") document.querySelector("[data-view=pos]").click();
        else Admin.load(action);
      };
  };

  Admin.reorderPage = async function () {
    const rows = await API.request("/reorder-suggestions");
    this.rows = rows;
    UI.$("adminToolbar").innerHTML =
      '<button class="primary" id="createSuggestedOrders" disabled>إنشاء أوامر شراء للمحدد</button><span>الحساب: آخر 30 يومًا + تغطية 7 أيام</span>';
    UI.$("adminContent").innerHTML = rows.length
      ? `<div class="reorder-list">${rows
          .map(
            (row) => `<article class="reorder-row">
              <label class="selection-check"><input type="checkbox" value="${row.id}" ${row.supplier_id ? "" : "disabled"}><span></span></label>
              <div class="reorder-product"><strong>${UI.escape(row.name_ar)}</strong><small class="ltr">${UI.escape(row.sku)}</small><p>${UI.escape(row.message)}</p></div>
              <dl><div><dt>المتاح</dt><dd>${row.qty_on_hand}</dd></div><div><dt>متوسط يومي</dt><dd>${row.average_daily_sales}</dd></div><div><dt>مدة التوريد</dt><dd>${row.lead_time_days} يوم</dd></div><div><dt>مخزون الأمان</dt><dd>${row.safety_stock}</dd></div><div><dt>نقطة الطلب</dt><dd>${row.reorder_point}</dd></div><div class="suggested"><dt>المقترح</dt><dd>${row.suggested_order_qty}</dd></div></dl>
              <div class="reorder-supplier"><span>المورد المقترح</span><strong>${UI.escape(row.supplier_name || "غير مرتبط بمورد")}</strong>${row.supplier_options[0]?.compliance_pct != null ? `<small>التزام ${row.supplier_options[0].compliance_pct}%</small>` : ""}</div>
            </article>`,
          )
          .join("")}</div>`
      : empty("المخزون يغطي الطلب", "لا توجد أصناف تحتاج إلى إعادة طلب وفق المبيعات الحالية.");
    const update = () =>
      (UI.$("createSuggestedOrders").disabled = !document.querySelector(
        ".reorder-row input:checked",
      ));
    for (const input of document.querySelectorAll(".reorder-row input"))
      input.onchange = update;
    UI.$("createSuggestedOrders").onclick = async () => {
      const items = [...document.querySelectorAll(".reorder-row input:checked")].map(
        (input) => ({ product_id: input.value }),
      );
      const button = UI.$("createSuggestedOrders");
      button.disabled = true;
      try {
        const orders = await API.request(
          "/reorder-suggestions/create-orders",
          "POST",
          { items },
        );
        UI.toast(`تم إنشاء ${orders.length} أمر شراء`);
        await this.load("purchase-orders");
      } catch (error) {
        UI.toast(error.message, true);
        button.disabled = false;
      }
    };
  };

  Admin.procurementPage = async function () {
    const [requests, quotes] = await Promise.all([
      API.request("/procurement/requests"),
      API.request("/procurement/quotes"),
    ]);
    UI.$("adminToolbar").innerHTML =
      '<button class="primary" id="newRequest">طلب شراء داخلي</button><button id="newQuote">تسجيل عرض مورد</button>';
    UI.$("adminContent").innerHTML = `<div class="operations-columns">
      <section class="report-section"><div class="panel-heading"><div><span class="eyebrow">المرحلة الأولى</span><h2>طلبات الشراء الداخلية</h2></div><span class="panel-tag">${requests.length}</span></div>
      ${this.table(requests, [["request_no", "الطلب"], ["requested_by_name", "مقدم الطلب"], ["items_count", "الأصناف"], ["status", "الحالة"], ["created_at", "التاريخ"]], (row) => row.status === "draft" ? `<button data-approve-request="${row.id}">اعتماد</button>` : `<button data-view-request="${row.id}">عرض</button>`)}</section>
      <section class="report-section"><div class="panel-heading"><div><span class="eyebrow">المقارنة</span><h2>عروض الموردين</h2></div><span class="panel-tag">${quotes.length}</span></div>
      ${this.table(quotes, [["quote_no", "العرض"], ["supplier_name", "المورد"], ["lead_time_days", "مدة التوريد"], ["compliance_pct", "الالتزام %"], ["total", "القيمة", "money"], ["status", "الحالة"]], (row) => row.status === "received" ? `<button class="primary" data-select-quote="${row.id}">اختيار وإنشاء أمر</button>` : "")}</section></div>`;
    UI.$("newRequest").onclick = () => this.newProcurementRequest();
    UI.$("newQuote").onclick = () => this.newSupplierQuote();
    for (const button of document.querySelectorAll("[data-approve-request]"))
      button.onclick = async () => {
        await API.request(
          "/procurement/requests/" + button.dataset.approveRequest + "/approve",
          "POST",
          {},
        );
        UI.toast("تم اعتماد طلب الشراء");
        this.load("procurement-requests");
      };
    for (const button of document.querySelectorAll("[data-view-request]"))
      button.onclick = async () => {
        const row = await API.request(
          "/procurement/requests/" + button.dataset.viewRequest,
        );
        UI.modal(
          "تفاصيل " + row.request_no,
          this.table(row.lines, [["sku", "SKU"], ["name_ar", "الصنف"], ["requested_qty", "الكمية"], ["supplier_name", "المورد المقترح"]]),
        );
      };
    for (const button of document.querySelectorAll("[data-select-quote]"))
      button.onclick = async () => {
        await API.request(
          `/procurement/quotes/${button.dataset.selectQuote}/create-order`,
          "POST",
          {},
        );
        UI.toast("تم اختيار العرض وإنشاء أمر شراء معتمد");
        await this.load("purchase-orders");
      };
  };

  Admin.productLinesDialog = async function (title, options, onSubmit) {
    const [products, suppliers] = await Promise.all([
      API.request("/lookups/products"),
      API.request("/suppliers"),
    ]);
    const dialog = UI.modal(
      title,
      `<form id="operationLinesForm"><div class="form-grid">${options.header || ""}<label class="wide">ملاحظات<input name="notes"></label></div><div id="operationLines" class="operation-lines"></div><button type="button" id="addOperationLine">إضافة صنف</button><div id="operationError" class="error"></div><footer><button type="button" data-close>إلغاء</button><button class="primary">حفظ</button></footer></form>`,
    );
    const add = () => {
      const line = document.createElement("div");
      line.className = "operation-line";
      line.innerHTML = `<select data-product>${products.map((p) => `<option value="${p.id}" data-cost="${p.cost_price}">${UI.escape(p.name_ar)} — ${UI.escape(p.sku)}</option>`).join("")}</select><input data-qty type="number" min="0.001" step="0.001" value="1" aria-label="الكمية">${options.cost ? `<input data-cost type="number" min="0" step="0.001" value="${products[0]?.cost_price || 0}" aria-label="تكلفة الوحدة">` : ""}${options.supplier ? `<select data-supplier>${suppliers.map((s) => `<option value="${s.id}">${UI.escape(s.name)}</option>`).join("")}</select>` : ""}<button type="button" data-remove>×</button>`;
      line.querySelector("[data-product]").onchange = (event) => {
        if (options.cost)
          line.querySelector("[data-cost]").value =
            event.target.selectedOptions[0].dataset.cost;
      };
      line.querySelector("[data-remove]").onclick = () => line.remove();
      UI.$("operationLines").append(line);
    };
    add();
    UI.$("addOperationLine").onclick = add;
    UI.$("operationLinesForm").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.target.querySelector(".primary");
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(event.target));
        data.items = [...UI.$("operationLines").children].map((line) => ({
          product_id: line.querySelector("[data-product]").value,
          qty: Number(line.querySelector("[data-qty]").value),
          unit_cost: options.cost
            ? Number(line.querySelector("[data-cost]").value)
            : undefined,
          supplier_id: options.supplier
            ? line.querySelector("[data-supplier]").value
            : undefined,
        }));
        if (!data.items.length) throw new Error("أضف صنفًا واحدًا على الأقل");
        await onSubmit(data);
        dialog.close();
      } catch (error) {
        UI.$("operationError").textContent = error.message;
        button.disabled = false;
      }
    };
    return dialog;
  };

  Admin.newProcurementRequest = function () {
    return this.productLinesDialog(
      "طلب شراء داخلي",
      { supplier: true },
      async (data) => {
        await API.request("/procurement/requests", "POST", data);
        UI.toast("تم إنشاء طلب الشراء");
        await this.load("procurement-requests");
      },
    );
  };

  Admin.newSupplierQuote = async function () {
    const [suppliers, requests] = await Promise.all([
      API.request("/suppliers"),
      API.request("/procurement/requests"),
    ]);
    const header = `<label>المورد<select name="supplier_id">${suppliers.map((s) => `<option value="${s.id}">${UI.escape(s.name)}</option>`).join("")}</select></label><label>طلب الشراء<select name="request_id"><option value="">دون طلب</option>${requests.map((r) => `<option value="${r.id}">${UI.escape(r.request_no)}</option>`).join("")}</select></label><label>مدة التوريد بالأيام<input name="lead_time_days" type="number" min="0" value="3"></label><label>صلاحية العرض<input name="valid_until" type="date"></label>`;
    return this.productLinesDialog(
      "تسجيل عرض مورد",
      { cost: true, header },
      async (data) => {
        await API.request("/procurement/quotes", "POST", data);
        UI.toast("تم تسجيل عرض المورد");
        await this.load("procurement-requests");
      },
    );
  };

  Admin.purchaseOrdersPage = async function () {
    const rows = await API.request("/purchase-orders");
    UI.$("adminToolbar").innerHTML =
      '<button class="primary" id="newPurchaseOrder">أمر شراء جديد</button>';
    UI.$("adminContent").innerHTML = this.table(
      rows,
      [["order_no", "الأمر"], ["supplier_name", "المورد"], ["items_count", "الأصناف"], ["total", "الإجمالي", "money"], ["expected_at", "التسليم المتوقع"], ["status", "الحالة"], ["created_at", "الإنشاء"]],
      (row) => `<button data-order-view="${row.id}">التفاصيل</button>${row.status === "draft" ? `<button data-order-send="${row.id}">إرسال</button>` : ""}${["sent", "partial"].includes(row.status) ? `<button class="primary" data-order-receive="${row.id}">استلام</button>` : ""}`,
    );
    UI.$("newPurchaseOrder").onclick = async () => {
      const suppliers = await API.request("/suppliers");
      const header = `<label>المورد<select name="supplier_id">${suppliers.map((s) => `<option value="${s.id}">${UI.escape(s.name)}</option>`).join("")}</select></label><label>التسليم المتوقع<input name="expected_at" type="date"></label><label>الإرسال مباشرة<select name="approve"><option value="1">نعم</option><option value="0">مسودة</option></select></label>`;
      this.productLinesDialog("أمر شراء جديد", { cost: true, header }, async (data) => {
        data.approve = Number(data.approve);
        await API.request("/purchase-orders", "POST", data);
        await this.load("purchase-orders");
      });
    };
    for (const button of document.querySelectorAll("[data-order-view]"))
      button.onclick = async () => this.showOrder(button.dataset.orderView);
    for (const button of document.querySelectorAll("[data-order-send]"))
      button.onclick = async () => {
        await API.request(`/purchase-orders/${button.dataset.orderSend}/send`, "POST", {});
        UI.toast("تم إرسال أمر الشراء");
        this.load("purchase-orders");
      };
    for (const button of document.querySelectorAll("[data-order-receive]"))
      button.onclick = async () => this.receiveOrder(button.dataset.orderReceive);
  };

  Admin.showOrder = async function (id) {
    const order = await API.request("/purchase-orders/" + id);
    UI.modal(
      `${order.order_no} — ${order.supplier_name}`,
      `<div class="detail-strip"><span>الحالة ${badge(order.status)}</span><span>الإجمالي <b class="money">${UI.money(order.total)}</b></span><span>المتوقع ${UI.escape(order.expected_at || "—")}</span></div>${this.table(order.lines, [["sku", "SKU"], ["name_ar", "الصنف"], ["ordered_qty", "المطلوب"], ["received_qty", "المستلم"], ["damaged_qty", "التالف"], ["short_qty", "الناقص"], ["unit_cost", "التكلفة", "money"]])}`,
    );
  };

  Admin.receiveOrder = async function (id) {
    const order = await API.request("/purchase-orders/" + id);
    const lines = order.lines.filter((line) => line.received_qty < line.ordered_qty);
    const dialog = UI.modal(
      `استلام ${order.order_no}`,
      `<form id="receiptForm"><p>سجّل المقبول والتالف والناقص لكل بند. تضاف الكمية المقبولة فقط إلى المخزون.</p><div class="receipt-lines">${lines.map((line) => `<div class="receipt-line" data-line="${line.id}"><strong>${UI.escape(line.name_ar)}</strong><small>المتبقي ${line.ordered_qty - line.received_qty}</small><label>مقبول<input data-accepted type="number" min="0" max="${line.ordered_qty - line.received_qty}" step="0.001" value="${line.ordered_qty - line.received_qty}"></label><label>تالف<input data-damaged type="number" min="0" step="0.001" value="0"></label><label>ناقص<input data-short type="number" min="0" step="0.001" value="0"></label></div>`).join("")}</div><label>ملاحظات<input name="notes"></label><div id="receiptError" class="error"></div><footer><button type="button" data-close>إلغاء</button><button class="primary">اعتماد الاستلام</button></footer></form>`,
    );
    UI.$("receiptForm").onsubmit = async (event) => {
      event.preventDefault();
      try {
        await API.request(`/purchase-orders/${id}/receive`, "POST", {
          notes: new FormData(event.target).get("notes"),
          items: [...document.querySelectorAll(".receipt-line")].map((line) => ({
            order_line_id: line.dataset.line,
            accepted_qty: Number(line.querySelector("[data-accepted]").value),
            damaged_qty: Number(line.querySelector("[data-damaged]").value),
            short_qty: Number(line.querySelector("[data-short]").value),
          })),
        });
        dialog.close();
        UI.toast("تم تحديث المخزون وحالة أمر الشراء");
        await POS.snapshot();
        await this.load("purchase-orders");
      } catch (error) {
        UI.$("receiptError").textContent = error.message;
      }
    };
  };

  Admin.supplierInvoicesPage = async function () {
    const rows = await API.request("/supplier-invoices");
    UI.$("adminToolbar").innerHTML =
      '<button class="primary" id="newSupplierInvoice">تسجيل فاتورة مورد</button>';
    UI.$("adminContent").innerHTML = this.table(
      rows,
      [["invoice_no", "الفاتورة"], ["order_no", "أمر الشراء"], ["supplier_name", "المورد"], ["total", "الإجمالي", "money"], ["paid_amount", "المدفوع", "money"], ["match_status", "المطابقة"], ["status", "الحالة"]],
      (row) => `${row.status === "pending" && row.match_status === "matched" ? `<button data-invoice-approve="${row.id}">اعتماد</button>` : ""}${["approved", "partially_paid"].includes(row.status) ? `<button class="primary" data-invoice-pay="${row.id}" data-balance="${row.total - row.paid_amount}">سداد</button>` : ""}`,
    );
    UI.$("newSupplierInvoice").onclick = () => this.newSupplierInvoice();
    for (const button of document.querySelectorAll("[data-invoice-approve]"))
      button.onclick = async () => {
        await API.request(`/supplier-invoices/${button.dataset.invoiceApprove}/approve`, "POST", {});
        UI.toast("تم اعتماد الفاتورة وقيد ذمة المورد");
        this.load("supplier-invoices");
      };
    for (const button of document.querySelectorAll("[data-invoice-pay]"))
      button.onclick = () =>
        this.form(
          "سداد فاتورة المورد",
          [
            this.field("amount", "المبلغ", "number", [], true, button.dataset.balance),
            this.field("payment_method", "طريقة الدفع", "select", [["cash", "نقدًا"], ["knet", "كي نت"]], true, "knet"),
          ],
          {},
          async (form) => {
            await API.request(`/supplier-invoices/${button.dataset.invoicePay}/pay`, "POST", Object.fromEntries(form));
            await this.load("supplier-invoices");
          },
        );
  };

  Admin.newSupplierInvoice = async function () {
    const orders = (await API.request("/purchase-orders")).filter((order) =>
      ["partial", "received"].includes(order.status),
    );
    if (!orders.length) return UI.toast("لا يوجد أمر شراء مستلم لإصدار فاتورة", true);
    const first = await API.request("/purchase-orders/" + orders[0].id);
    const dialog = UI.modal(
      "تسجيل فاتورة مورد",
      `<form id="supplierInvoiceForm"><div class="form-grid"><label>أمر الشراء<select name="order_id">${orders.map((order) => `<option value="${order.id}">${UI.escape(order.order_no)} — ${UI.escape(order.supplier_name)}</option>`).join("")}</select></label><label>رقم فاتورة المورد<input name="invoice_no" required></label></div><div id="invoiceLines"></div><div id="invoiceError" class="error"></div><footer><button type="button" data-close>إلغاء</button><button class="primary">فحص المطابقة وحفظ</button></footer></form>`,
    );
    const render = async (id) => {
      const order = id === first.id ? first : await API.request("/purchase-orders/" + id);
      UI.$("invoiceLines").innerHTML = `<div class="receipt-lines">${order.lines.map((line) => `<div class="receipt-line" data-line="${line.id}"><strong>${UI.escape(line.name_ar)}</strong><small>المستلم ${line.received_qty}</small><label>الكمية<input data-qty type="number" min="0" step="0.001" value="${line.received_qty}"></label><label>التكلفة<input data-cost type="number" min="0" step="0.001" value="${line.unit_cost}"></label></div>`).join("")}</div>`;
    };
    await render(first.id);
    dialog.querySelector("[name=order_id]").onchange = (event) => render(event.target.value);
    UI.$("supplierInvoiceForm").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const form = new FormData(event.target);
        await API.request("/supplier-invoices", "POST", {
          order_id: form.get("order_id"),
          invoice_no: form.get("invoice_no"),
          items: [...document.querySelectorAll("#invoiceLines .receipt-line")].map((line) => ({
            order_line_id: line.dataset.line,
            qty: Number(line.querySelector("[data-qty]").value),
            unit_cost: Number(line.querySelector("[data-cost]").value),
          })),
        });
        dialog.close();
        await this.load("supplier-invoices");
      } catch (error) {
        UI.$("invoiceError").textContent = error.message;
      }
    };
  };

  Admin.cycleCountsPage = async function () {
    const rows = await API.request("/cycle-counts");
    UI.$("adminToolbar").innerHTML =
      '<button class="primary" id="generateCycleCount">إنشاء قائمة اليوم</button><button id="showABC">عرض تصنيف ABC</button>';
    UI.$("adminContent").innerHTML = this.table(
      rows,
      [["count_no", "القائمة"], ["generated_by_name", "أنشأها"], ["items_count", "الأصناف"], ["counted_items", "تم عده"], ["variance_items", "فروقات"], ["status", "الحالة"], ["created_at", "التاريخ"]],
      (row) => `<button class="primary" data-cycle="${row.id}">${row.status === "open" ? "تنفيذ الجرد" : "عرض"}</button>`,
    );
    UI.$("generateCycleCount").onclick = () =>
      this.form(
        "إنشاء جرد دوري موجه",
        [this.field("limit", "عدد الأصناف", "number", [], true, 20), this.field("notes", "ملاحظات")],
        {},
        async (form) => {
          await API.request("/cycle-counts", "POST", Object.fromEntries(form));
          await this.load("cycle-counts");
        },
      );
    UI.$("showABC").onclick = async () => {
      const items = await API.request("/cycle-counts/classification");
      UI.modal(
        "تصنيف المخزون ABC",
        this.table(items, [["sku", "SKU"], ["name_ar", "الصنف"], ["abc_class", "التصنيف"], ["sales_value", "قيمة مبيعات 90 يومًا", "money"], ["qty_on_hand", "المخزون"], ["interval_days", "دورية الجرد بالأيام"]]),
      );
    };
    for (const button of document.querySelectorAll("[data-cycle]"))
      button.onclick = () => this.openCycleCount(button.dataset.cycle);
  };

  Admin.openCycleCount = async function (id) {
    const count = await API.request("/cycle-counts/" + id);
    const dialog = UI.modal(
      `الجرد ${count.count_no}`,
      `<div class="cycle-workspace"><div class="detail-strip"><span>الحالة ${badge(count.status)}</span><span>${count.lines.length} صنف</span></div>${
        count.status === "open"
          ? `<form id="cycleScanForm" class="cycle-scan"><label>امسح الباركود أو اختر الصنف<input name="barcode" placeholder="الباركود" autofocus></label><label>الصنف<select name="product_id"><option value="">حسب الباركود</option>${count.lines.map((line) => `<option value="${line.product_id}">${UI.escape(line.name_ar)} — ${UI.escape(line.sku)}</option>`).join("")}</select></label><label>الكمية الفعلية<input name="counted_qty" type="number" min="0" step="0.001" required></label><label>سبب الفرق<input name="reason" placeholder="مطلوب عند وجود فرق"></label><button class="primary">تسجيل العد</button></form>`
          : ""
      }<div id="cycleLines">${this.table(count.lines, [["abc_class", "ABC"], ["sku", "SKU"], ["name_ar", "الصنف"], ["expected_qty", "المتوقع"], ["counted_qty", "الفعلي"], ["variance", "الفرق"], ["reason", "السبب"]])}</div>${count.status === "open" ? '<footer><button id="completeCycle" class="primary">اعتماد الفروقات وإكمال الجرد</button></footer>' : ""}</div>`,
    );
    if (count.status === "open") {
      UI.$("cycleScanForm").onsubmit = async (event) => {
        event.preventDefault();
        try {
          const updated = await API.request(`/cycle-counts/${id}/count`, "POST", Object.fromEntries(new FormData(event.target)));
          UI.$("cycleLines").innerHTML = this.table(updated.lines, [["abc_class", "ABC"], ["sku", "SKU"], ["name_ar", "الصنف"], ["expected_qty", "المتوقع"], ["counted_qty", "الفعلي"], ["variance", "الفرق"], ["reason", "السبب"]]);
          event.target.reset();
          event.target.elements.barcode.focus();
        } catch (error) {
          UI.toast(error.message, true);
        }
      };
      UI.$("completeCycle").onclick = async () => {
        try {
          await API.request(`/cycle-counts/${id}/complete`, "POST", {});
          dialog.close();
          await POS.snapshot();
          await this.load("cycle-counts");
          UI.toast("تم اعتماد الجرد وتسجيل القيود والتسويات");
        } catch (error) {
          UI.toast(error.message, true);
        }
      };
    }
  };

  Admin.memberBenefitsPage = async function () {
    const members = await API.request("/members");
    UI.$("adminToolbar").innerHTML =
      '<input id="adminSearch" type="search" placeholder="ابحث عن عضو"><button id="specialPrices">الأسعار الخاصة</button>';
    this.rows = members;
    const draw = () => {
      const query = UI.$("adminSearch").value.toLocaleLowerCase();
      const rows = members.filter((row) =>
        [row.name, row.membership_no, row.phone].some((value) =>
          String(value || "").toLocaleLowerCase().includes(query),
        ),
      );
      UI.$("adminContent").innerHTML = this.table(
        rows.slice(0, 100),
        [["membership_no", "العضوية"], ["name", "العضو"], ["category_name", "الفئة"], ["phone", "الهاتف"], ["status", "الحالة"]],
        (row) => `<button class="primary" data-member-benefits="${row.id}">السجل والمزايا</button>`,
      );
      for (const button of document.querySelectorAll("[data-member-benefits]"))
        button.onclick = () => this.openMemberBenefits(button.dataset.memberBenefits);
    };
    UI.$("adminSearch").oninput = draw;
    UI.$("specialPrices").onclick = () => this.specialPricesDialog();
    draw();
  };

  Admin.openMemberBenefits = async function (id) {
    const data = await API.request(`/members/${id}/experience`);
    const dialog = UI.modal(
      `مزايا العضو — ${data.name}`,
      `<div class="member-operations"><div class="metrics compact-metrics">${AdminDesign.metric("إجمالي المشتريات", UI.money(data.total_spend), "receipt", `${data.transactions_count} فاتورة`, "blue")}${AdminDesign.metric("إجمالي التوفير", UI.money(data.total_savings), "discounts", "خصومات وأسعار خاصة", "teal")}${AdminDesign.metric("رصيد المحفظة", UI.money(data.wallet_balance), "accounting", "رصيد قابل للإدارة", "amber")}</div>
      ${data.expiry_warning ? '<div class="inline-alert">تنبيه: العضوية منتهية أو ستنتهي خلال 30 يومًا.</div>' : ""}
      <div class="operations-columns"><form id="memberProfileForm" class="operation-card"><h3>الحدود والموافقة</h3><label>تاريخ الانتهاء<input name="expiry_date" type="date" value="${UI.escape(data.expiry_date || "")}"></label><label>حد الشراء الشهري<input name="purchase_limit" type="number" min="0" step="0.001" value="${UI.escape(data.purchase_limit ?? "")}"></label><label>الفاتورة الإلكترونية<select name="receipt_consent"><option value="0">دون موافقة</option><option value="1" ${data.receipt_consent ? "selected" : ""}>موافق</option></select></label><label>القناة<select name="preferred_channel"><option value="">—</option><option value="email" ${data.preferred_channel === "email" ? "selected" : ""}>البريد</option><option value="message" ${data.preferred_channel === "message" ? "selected" : ""}>الرسائل</option></select></label><button class="primary">حفظ الملف</button></form>
      <form id="walletForm" class="operation-card"><h3>المحفظة</h3><label>المبلغ<input name="amount" type="number" step="0.001" required></label><label>السبب<input name="notes" required></label><button>إضافة أو خصم الرصيد</button><h3>إضافة تابع</h3><label>الاسم<input name="dependent_name"></label><label>صلة القرابة<input name="relationship"></label><button type="button" id="addDependent">إضافة التابع</button><h3>قسيمة شراء</h3><label>الرمز<input name="voucher_code"></label><label>القيمة<input name="voucher_value" type="number" min="0" step="0.001"></label><label>تنتهي في<input name="voucher_expiry" type="date"></label><button type="button" id="addVoucher">إنشاء القسيمة</button></form></div>
      <section class="report-section"><h3>آخر المشتريات</h3>${this.table(data.recent_sales, [["invoice_no", "الفاتورة"], ["net_total", "الصافي", "money"], ["discount_total", "التوفير", "money"], ["created_at", "التاريخ"]])}</section>
      <section class="report-section"><h3>التابعون</h3>${this.table(data.dependents, [["name", "الاسم"], ["relationship", "صلة القرابة"], ["civil_id", "المدني"], ["status", "الحالة"]])}</section>
      <section class="report-section"><h3>القسائم الفعالة</h3>${this.table(data.vouchers, [["code", "الرمز"], ["value", "القيمة", "money"], ["remaining_value", "المتبقي", "money"], ["expires_at", "الانتهاء"], ["status", "الحالة"]])}</section></div>`,
    );
    UI.$("memberProfileForm").onsubmit = async (event) => {
      event.preventDefault();
      await API.request(`/members/${id}/profile`, "PUT", Object.fromEntries(new FormData(event.target)));
      UI.toast("تم حفظ ملف العضوية");
    };
    UI.$("walletForm").onsubmit = async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target));
      await API.request(`/members/${id}/wallet`, "POST", body);
      dialog.close();
      this.openMemberBenefits(id);
    };
    UI.$("addDependent").onclick = async () => {
      const form = UI.$("walletForm");
      await API.request(`/members/${id}/dependents`, "POST", {
        name: form.elements.dependent_name.value,
        relationship: form.elements.relationship.value,
      });
      dialog.close();
      this.openMemberBenefits(id);
    };
    UI.$("addVoucher").onclick = async () => {
      const form = UI.$("walletForm");
      await API.request("/member-vouchers", "POST", {
        member_id: id,
        code: form.elements.voucher_code.value,
        value: form.elements.voucher_value.value,
        expires_at: form.elements.voucher_expiry.value,
      });
      dialog.close();
      UI.toast("تم إنشاء قسيمة العضو");
      this.openMemberBenefits(id);
    };
  };

  Admin.specialPricesDialog = async function () {
    const [prices, categories, products] = await Promise.all([
      API.request("/member-special-prices"),
      API.request("/membership-categories"),
      API.request("/lookups/products"),
    ]);
    const dialog = UI.modal(
      "الأسعار الخاصة بفئات العضوية",
      `<form id="specialPriceForm" class="form-grid"><label>فئة العضوية<select name="membership_category_id">${categories.map((c) => `<option value="${c.id}">${UI.escape(c.name_ar)}</option>`).join("")}</select></label><label>الصنف<select name="product_id">${products.map((p) => `<option value="${p.id}">${UI.escape(p.name_ar)}</option>`).join("")}</select></label><label>السعر الخاص<input name="special_price" type="number" min="0" step="0.001" required></label><label>من<input name="starts_at" type="date"></label><label>إلى<input name="ends_at" type="date"></label><button class="primary">حفظ السعر</button></form>${this.table(prices, [["category_name", "فئة العضوية"], ["product_name", "الصنف"], ["special_price", "السعر", "money"], ["starts_at", "من"], ["ends_at", "إلى"]])}`,
    );
    UI.$("specialPriceForm").onsubmit = async (event) => {
      event.preventDefault();
      await API.request("/member-special-prices", "POST", Object.fromEntries(new FormData(event.target)));
      dialog.close();
      UI.toast("تم حفظ السعر الخاص");
    };
  };

  Admin.devicesPage = async function () {
    const [rows, jobs] = await Promise.all([
      API.request("/devices"),
      API.request("/device-jobs"),
    ]);
    UI.$("adminToolbar").innerHTML =
      '<button id="openCustomerDisplay">فتح شاشة العميل</button><button class="primary" id="printProductLabels">طباعة ملصقات الأصناف</button>';
    UI.$("adminContent").innerHTML = `<div class="device-grid">${rows
      .map(
        (device) => `<article class="device-card"><i>${AdminDesign.icon("devices")}</i><div><span>${UI.escape(device.device_type)}</span><h2>${UI.escape(device.name)}</h2><p>المحول: ${UI.escape(device.adapter)}</p>${badge(device.status)}</div><div><button data-device-edit="${device.device_type}">تهيئة</button><button data-device-test="${device.device_type}">اختبار</button></div></article>`,
      )
      .join("")}</div><section class="report-section"><div class="panel-heading"><div><span class="eyebrow">سجل التشغيل</span><h2>مهام الأجهزة والإرسال</h2></div><span class="panel-tag">${jobs.length}</span></div>${this.table(jobs.slice(0, 50), [["device_type", "الجهاز / القناة"], ["job_type", "المهمة"], ["status", "الحالة"], ["created_at", "وقت الإنشاء"], ["completed_at", "وقت التنفيذ"]])}</section>`;
    UI.$("openCustomerDisplay").onclick = () =>
      CustomerDisplayBridge.open();
    UI.$("printProductLabels").onclick = async () => {
      const products = await API.request("/lookups/products");
      this.form(
        "طباعة ملصقات الأسعار والباركود",
        [
          this.field(
            "product_id",
            "الصنف",
            "select",
            products.map((product) => [product.id, `${product.sku} — ${product.name_ar}`]),
            true,
          ),
          this.field("copies", "عدد النسخ", "number", [], true, 1),
        ],
        {},
        async (form) => {
          const values = Object.fromEntries(form);
          await API.request("/devices/label-print", "POST", {
            items: [{ product_id: values.product_id, copies: values.copies }],
          });
          UI.toast("أُرسل الملصق إلى طابعة الملصقات");
        },
      );
    };
    for (const button of document.querySelectorAll("[data-device-test]"))
      button.onclick = async () => {
        const result = await API.request(`/devices/${button.dataset.deviceTest}/test`, "POST", {});
        UI.toast(result.queued ? "نجح اختبار الجهاز" : "فعّل الجهاز أولًا", !result.queued);
      };
    for (const button of document.querySelectorAll("[data-device-edit]")) {
      const device = rows.find((row) => row.device_type === button.dataset.deviceEdit);
      button.onclick = () =>
        this.form(
          "تهيئة " + device.name,
          [
            this.field("name", "الاسم", "text", [], true, device.name),
            this.field("adapter", "المحول", "select", [["browser", "المتصفح"], ["keyboard", "لوحة المفاتيح"], ["barcode", "باركود"], ["simulator", "محاكي آمن"], ["external", "مزود خارجي"]], true, device.adapter),
            this.field("status", "الحالة", "select", [["active", "فعال"], ["inactive", "غير فعال"]], true, device.status),
            this.field("configuration", "الإعدادات JSON", "textarea", [], false, JSON.stringify(device.configuration, null, 2)),
          ],
          {},
          async (form) => {
            const body = Object.fromEntries(form);
            body.configuration = JSON.parse(body.configuration || "{}");
            await API.request(`/devices/${device.device_type}`, "PUT", body);
            await this.load("devices");
          },
        );
    }
  };

  Admin.backupsPage = async function () {
    const [rows, health] = await Promise.all([
      API.request("/backups"),
      API.request("/backups/health"),
    ]);
    UI.$("adminToolbar").innerHTML =
      '<button class="primary" id="createBackup">إنشاء نسخة مشفرة الآن</button>';
    UI.$("adminContent").innerHTML = `<div class="backup-health ${health.healthy ? "healthy" : "unhealthy"}">${AdminDesign.icon(health.healthy ? "check" : "alert")}<div><strong>${health.healthy ? "النسخ الاحتياطي سليم" : "النسخ الاحتياطي يحتاج انتباهًا"}</strong><p>${health.last ? `آخر نسخة سليمة: ${UI.escape(health.last.created_at)}` : "لم تُسجل نسخة سليمة بعد"}</p></div></div>${this.table(rows, [["file_name", "الملف"], ["file_size", "الحجم بالبايت"], ["trigger_type", "المصدر"], ["integrity_status", "السلامة"], ["restore_tests", "اختبارات الاستعادة"], ["last_restore_test_at", "آخر استعادة تجريبية"], ["created_by_name", "أنشأها"], ["created_at", "التاريخ"]], (row) => `<button data-backup-verify="${row.id}">اختبار</button><button data-backup-dry="${row.id}">استعادة تجريبية</button><button data-backup-download="${row.id}">تنزيل</button>`)}`;
    UI.$("createBackup").onclick = async () => {
      const button = UI.$("createBackup");
      button.disabled = true;
      try {
        await API.request("/backups", "POST", {});
        UI.toast("تم إنشاء النسخة وتحقق النظام من سلامتها");
        await this.load("backups");
      } catch (error) {
        UI.toast(error.message, true);
        button.disabled = false;
      }
    };
    for (const button of document.querySelectorAll("[data-backup-verify]"))
      button.onclick = async () => {
        const result = await API.request(`/backups/${button.dataset.backupVerify}/verify`, "POST", {});
        UI.toast(result.valid ? "النسخة سليمة" : result.error, !result.valid);
        this.load("backups");
      };
    for (const button of document.querySelectorAll("[data-backup-dry]"))
      button.onclick = async () => {
        const result = await API.request(`/backups/${button.dataset.backupDry}/dry-run`, "POST", {});
        UI.toast(result.valid ? "نجحت الاستعادة التجريبية دون التأثير في النظام" : result.error, !result.valid);
      };
    for (const button of document.querySelectorAll("[data-backup-download]"))
      button.onclick = () =>
        UI.download(`/backups/${button.dataset.backupDownload}/download`, "KTS-Backup.ktsbackup");
  };
})();
