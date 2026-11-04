/* Shared presentation for the administration workspace. Business actions live in admin.js. */
window.AdminDesign = {
  paths: {
    dashboard: "M3 3h7v7H3z M14 3h7v11h-7z M3 14h7v7H3z M14 18h7v3h-7z",
    products: "m12 3 9 5-9 5-9-5 9-5z M3 8v9l9 5 9-5V8 M12 13v9 M7 5.8l9 5",
    categories: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    inventory: "m3 9 9-6 9 6v12H3V9z M8 21V11h8v10 M8 16h8",
    movements: "M4 7h16m-4-4 4 4-4 4 M20 17H4m4-4-4 4 4 4",
    suppliers:
      "M3 6h11v12H3z M14 10h4l3 4v4h-7 M5 18a2 2 0 1 0 4 0 M15 18a2 2 0 1 0 4 0",
    purchases: "M4 5h16l-1 16H5L4 5z M8 8V6a4 4 0 0 1 8 0v2 M9 13h6 M12 10v6",
    reorder: "M4 18V6 M4 6l4 4 M4 6 0 0 4-4 M10 18h10 M14 14l4 4-4 4",
    exceptions: "m12 3 10 18H2L12 3z M12 9v5 M12 17h.01",
    "procurement-requests": "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5",
    "purchase-orders": "M3 6h11v12H3z M14 10h4l3 4v4h-7 M5 18a2 2 0 1 0 4 0 M15 18a2 2 0 1 0 4 0",
    "supplier-invoices": "M5 2l3 2 4-2 4 2 3-2v20l-3-2-4 2-4-2-3 2V2z M8 8h8 M8 12h8 M8 16h4",
    "cycle-counts": "M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16 M8 14h2 M14 14h2 M8 18h2",
    "member-benefits": "M12 21s8-4.5 8-11a5 5 0 0 0-8-4 5 5 0 0 0-8 4c0 6.5 8 11 8 11z M12 9v7 M9 12h6",
    devices: "M4 4h16v13H4z M8 21h8 M12 17v4 M8 8h8",
    backups: "M4 6a8 8 0 1 1-1 7 M4 6v6h6 M12 7v5l3 2",
    members:
      "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 3a4 4 0 0 1 0 8 M22 21v-3a4 4 0 0 0-3-4",
    discounts:
      "m3 3 10 0 9 9-10 10-9-9V3z M7 7h.01 M10 16l6-6 M10 10h.01 M16 16h.01",
    shifts: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 3",
    schedules: "M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16 M8 14h2 M14 14h2 M8 18h2",
    reports: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4",
    accounting: "M3 5h18v15H3z M3 9h18 M15 12h6v5h-6z M17 14.5h.01",
    journal: "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5 M3 7h4 M3 11h4 M3 15h4",
    audit: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4z m-4 10 3 3 5-6",
    users:
      "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10 M3 22v-2a7 7 0 0 1 7-6h4a7 7 0 0 1 7 6v2",
    import: "M4 15v6h16v-6 M12 16V3 m-5 5 5-5 5 5",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
    search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 m5-2 6 6",
    plus: "M12 5v14 M5 12h14",
    refresh: "M20 7A9 9 0 1 0 21 15 M20 2v6h-6",
    arrow: "M19 12H5 m6-6-6 6 6 6",
    edit: "m15 3 6 6-11 11-7 1 1-7L15 3z M12 6l6 6",
    alert: "m12 3 10 18H2L12 3z M12 9v5 M12 17h.01",
    receipt:
      "M5 2l3 2 4-2 4 2 3-2v20l-3-2-4 2-4-2-3 2V2z M8 8h8 M8 12h8 M8 16h4",
    check: "m5 12 4 4L19 6",
    download: "M12 3v13 m-5-5 5 5 5-5 M4 16v5h16v-5",
    close: "M6 6l12 12 M18 6 6 18",
  },
  descriptions: {
    dashboard: "صورة واضحة لأداء اليوم، وكل ما يحتاج انتباهك.",
    products: "كتالوج متكامل لأصنافك وأسعارها وتوافرها.",
    categories: "تنظيم الأصناف في فئات يسهل الوصول إليها.",
    inventory: "راقب الأرصدة وسجّل التسويات بدقة.",
    movements: "تتبّع رحلة كل صنف، من التوريد إلى البيع.",
    suppliers: "بيانات شركائك وأرصدتهم في مكان واحد.",
    purchases: "إدارة التوريد ومتابعة المدفوعات والمشتريات.",
    reorder: "توقع الاحتياج وحوّل النواقص إلى أوامر شراء جاهزة.",
    exceptions: "المشكلات التشغيلية التي تحتاج إجراءً الآن في شاشة واحدة.",
    "procurement-requests": "طلبات داخلية وعروض موردين قابلة للمقارنة والاعتماد.",
    "purchase-orders": "تابع الإرسال والاستلام الجزئي والتالف والناقص.",
    "supplier-invoices": "طابق فاتورة المورد مع الأمر والاستلام قبل السداد.",
    "cycle-counts": "جرد يومي موجّه حسب قيمة الصنف وسرعة حركته.",
    "member-benefits": "سجل العضو وتوفيره وحدوده وتوابعه ورصيده وقسائمه.",
    devices: "تهيئة الطابعات والدرج والقارئ والميزان وK-Net واختبارها.",
    backups: "نسخ مشفرة واختبار سلامة واستعادة تجريبية قابلة للتدقيق.",
    members: "إدارة العضويات وبيانات المستفيدين.",
    discounts: "قواعد واضحة للخصومات والاستحقاقات.",
    shifts: "متابعة الورديات والتحصيل وإقفال الصندوق.",
    schedules: "تنظيم فترات العمل وتوزيع دوام الفريق.",
    reports: "حوّل تفاصيل المبيعات إلى رؤية قابلة للقياس.",
    accounting: "أرصدة الحسابات وميزان المراجعة والنتيجة المالية.",
    journal: "سجل محاسبي منظّم للحركات والقيود اليومية.",
    audit: "شفافية كاملة لتغييرات النظام وإجراءات المستخدمين.",
    users: "إدارة الفريق والأدوار وصلاحيات الوصول.",
    import: "أضف بيانات الأصناف والأعضاء من ملفاتك.",
    settings: "هوية الفرع وتفاصيل الفاتورة التي تصل إلى عملائك.",
  },
  icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${this.paths[name] || this.paths.products}"/></svg>`;
  },
  heading(section, label) {
    return `<div><div class="admin-breadcrumb">مساحة الإدارة <span>/</span> ${UI.escape(label)}</div><h1>${UI.escape(label)}<span class="heading-dot"></span></h1><p>${this.descriptions[section]}</p></div><div class="heading-tools"><span class="admin-date">${this.icon("schedules")}${new Intl.DateTimeFormat("ar-KW", { day: "numeric", month: "long", year: "numeric" }).format(new Date())}</span><button id="adminRefresh" title="تحديث البيانات" aria-label="تحديث البيانات">${this.icon("refresh")}</button></div>`;
  },
  metric(label, value, icon, note, tone = "teal") {
    return `<article class="metric metric-${tone}"><div class="metric-top"><span>${label}</span><i>${this.icon(icon)}</i></div><strong class="money">${value}</strong><small>${note}</small></article>`;
  },
  decorate() {
    const area = UI.$("adminView");
    for (const button of area.querySelectorAll(
      "#adminToolbar button, td button",
    )) {
      if (button.querySelector("svg")) continue;
      const icon = button.dataset.edit
        ? "edit"
        : button.dataset.delete
          ? "close"
          : button.id.startsWith("excel")
            ? "download"
            : button.classList.contains("primary")
              ? "plus"
              : "receipt";
      button.insertAdjacentHTML("afterbegin", this.icon(icon));
    }
    const search = UI.$("adminSearch");
    if (search && !search.closest(".admin-search")) {
      const wrapper = document.createElement("label");
      wrapper.className = "admin-search";
      search.before(wrapper);
      wrapper.innerHTML = this.icon("search");
      wrapper.append(search);
      search.setAttribute("aria-label", "البحث في سجلات القسم");
      search.placeholder = "ابحث بالاسم أو الرمز أو التفاصيل…";
    }
    for (const metric of area.querySelectorAll(
      ".metric:not(:has(.metric-top))",
    )) {
      if (!metric.querySelector("svg"))
        metric.insertAdjacentHTML(
          "afterbegin",
          `<i class="metric-symbol">${this.icon("reports")}</i>`,
        );
    }
  },
};

Admin.init = async function () {
  const groups = [
    ["الرؤية والأداء", ["dashboard", "exceptions", "reports", "accounting", "journal"]],
    [
      "التجارة والمخزون",
      [
        "products",
        "categories",
        "inventory",
        "movements",
        "suppliers",
        "purchases",
        "reorder",
        "procurement-requests",
        "purchase-orders",
        "supplier-invoices",
        "cycle-counts",
      ],
    ],
    [
      "الأعضاء والفريق",
      ["members", "member-benefits", "discounts", "shifts", "schedules", "users"],
    ],
    ["إدارة النظام", ["audit", "import", "customer-display", "devices", "backups", "settings"]],
  ];
  UI.$("adminSidebar").innerHTML =
    `<div class="admin-identity"><span class="identity-mark">K<span>TS</span></span><div><strong>مساحة الإدارة</strong><small>جمعية المعلمين الكويتية</small></div></div><div class="sidebar-scroll">${groups
      .map(([title, keys]) => {
        const items = this.sections
          .filter((s) => keys.includes(s[0]) && Auth.can(s[2]))
          .sort((a, b) => keys.indexOf(a[0]) - keys.indexOf(b[0]));
        return items.length
          ? `<div class="sidebar-group"><p>${title}</p>${items.map(([key, label]) => `<button data-section="${key}">${AdminDesign.icon(key)}<span>${label}</span>${key === "dashboard" ? '<span class="nav-dot"></span>' : ""}</button>`).join("")}</div>`
          : "";
      })
      .join(
        "",
      )}</div><div class="sidebar-profile"><span class="profile-avatar">${UI.escape((Auth.user.full_name || "م").slice(0, 1))}</span><div><strong>${UI.escape(Auth.user.full_name)}</strong><small>مساحة عملك المتكاملة</small></div><span class="profile-dot"></span></div>`;
  for (const button of UI.$("adminSidebar").querySelectorAll("[data-section]"))
    button.onclick = () => this.load(button.dataset.section);
  if (!this.sections.some((s) => s[0] === this.section && Auth.can(s[2])))
    this.section = this.sections.find((s) => Auth.can(s[2]))?.[0];
  await this.load(this.section);
};

const originalAdminLoad = Admin.load;
Admin.load = async function (section) {
  await originalAdminLoad.call(this, section);
  if (this.section === section) {
    AdminDesign.decorate();
    const refresh = UI.$("adminRefresh");
    if (refresh) refresh.onclick = () => this.load(this.section);
  }
};

Admin.table = function (rows, columns, actions) {
  const cell = (row, key, type) => {
    const value = row[key],
      text = UI.escape(this.display(key, value));
    if (type === "money")
      return `<span class="money">${UI.money(value)}</span>`;
    if (type === "json")
      return value
        ? `<details class="audit-details"><summary>عرض التفاصيل</summary><pre>${UI.escape(value)}</pre></details>`
        : '<span class="cell-muted">—</span>';
    if (key === "status")
      return `<span class="status-badge status-${UI.escape(value)}"><i></i>${text}</span>`;
    if (
      [
        "name_ar",
        "full_name",
        "name",
        "cashier_name",
        "supplier_name",
      ].includes(key)
    )
      return `<span class="name-cell"><span class="cell-avatar">${UI.escape(String(value || "").slice(0, 1)) || "—"}</span><strong>${text || "—"}</strong></span>`;
    if (
      [
        "sku",
        "code",
        "invoice_no",
        "purchase_no",
        "membership_no",
        "shift_no",
      ].includes(key)
    )
      return `<span class="cell-code">${text}</span>`;
    if (key === "payment_method")
      return `<span class="payment-label">${AdminDesign.icon(value === "cash" ? "accounting" : "receipt")}${text}</span>`;
    return text || '<span class="cell-muted">—</span>';
  };
  return `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th scope="col">${c[1]}</th>`).join("")}${actions ? '<th scope="col">الإجراء</th>' : ""}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([key, , type]) => `<td>${cell(row, key, type)}</td>`).join("")}${actions ? `<td class="table-actions">${actions(row)}</td>` : ""}</tr>`).join("")}</tbody></table>${rows.length ? "" : `<div class="empty-state"><span class="empty-icon">${AdminDesign.icon("search")}</span><strong>لا توجد سجلات لعرضها</strong><p>ستظهر البيانات هنا عند إضافتها، أو جرّب تغيير كلمات البحث.</p></div>`}</div>`;
};

const originalDrawTable = Admin.drawTable;
Admin.drawTable = function () {
  originalDrawTable.call(this);
  const count = UI.$("adminContent").querySelectorAll("tbody tr").length;
  UI.$("adminContent").insertAdjacentHTML(
    "afterbegin",
    `<div class="list-heading"><h2>${this.sections.find((s) => s[0] === this.section)?.[1] || ""} <span>${this.filteredCount}</span></h2><small>${this.filteredCount} من ${this.rows.length} سجل</small></div>`,
  );
  const pages = Math.max(1, Math.ceil(this.filteredCount / 20));
  UI.$("adminContent").insertAdjacentHTML(
    "beforeend",
    `<nav class="table-pagination" aria-label="صفحات السجلات"><small>${count ? (this.tablePage - 1) * 20 + 1 : 0}–${(this.tablePage - 1) * 20 + count} من ${this.filteredCount}</small><div><button id="adminPrevious" ${this.tablePage === 1 ? "disabled" : ""}>السابق</button><span>صفحة ${this.tablePage} من ${pages}</span><button id="adminNext" ${this.tablePage === pages ? "disabled" : ""}>التالي</button></div></nav>`,
  );
  UI.$("adminPrevious").onclick = () => {
    this.tablePage--;
    this.drawTable();
  };
  UI.$("adminNext").onclick = () => {
    this.tablePage++;
    this.drawTable();
  };
  AdminDesign.decorate();
};

Admin.dashboard = async function () {
  const data = await API.request("/reports/dashboard");
  if (this.section !== "dashboard") return;
  const d = AdminDesign;
  const total = data.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const cash = Number(
    data.payments.find((p) => p.payment_method === "cash")?.amount || 0,
  );
  const ratio =
    total > 0 ? Math.max(0, Math.min(100, (cash / total) * 100)) : 0;
  const maxCategory = Math.max(
    1,
    ...data.categories.map((c) => Number(c.net_total)),
  );
  const shortcuts = [
    ["products", "إدارة الأصناف", "catalog_manage"],
    ["purchases", "تسجيل توريد", "suppliers_manage"],
    ["members", "إدارة الأعضاء", "members_manage"],
    ["reports", "تقارير المبيعات", "reports_view"],
  ].filter((s) => Auth.can(s[2]));
  UI.$("adminContent").innerHTML =
    `<section class="admin-welcome"><div><span class="eyebrow">كل التفاصيل. رؤية واحدة.</span><h2>مرحبًا، ${UI.escape(Auth.user.full_name)} <span>✦</span></h2><p>تابع أعمالك اليوم بثقة؛ مبيعاتك ومخزونك وفريقك أمامك.</p><div class="welcome-status"><span></span>ملخص عمليات اليوم</div></div><div class="welcome-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-card">${d.icon("reports")}<span>رؤية أوضح</span><b>نمو مستمر</b><div class="art-bars"><i></i><i></i><i></i><i></i><i></i></div></div><span class="art-spark">✦</span></div></section>
  <div class="metrics dashboard-metrics">${d.metric("صافي مبيعات اليوم", UI.money(data.net_after_refunds), "accounting", "بعد احتساب المرتجعات", "teal")}${d.metric("الفواتير الصادرة", data.invoice_count, "receipt", "إجمالي فواتير اليوم", "blue")}${d.metric("أصناف تحتاج التوريد", data.low_stock, "inventory", "عند حد التنبيه أو أقل", "amber")}${d.metric("الورديات المفتوحة", data.open_shifts, "shifts", "متابعة التشغيل الآن", "violet")}</div>
  <div class="dashboard-grid"><section class="report-section category-panel"><div class="panel-heading"><div><span class="eyebrow">أداء المبيعات</span><h2>المبيعات حسب الفئة</h2></div><span class="panel-tag">اليوم</span></div><div class="category-bars">${data.categories.length ? data.categories.map((c, i) => `<div class="category-bar"><div><span><i class="category-key color-${i % 4}"></i>${UI.escape(c.name_ar)}</span><b class="money">${UI.money(c.net_total)}</b></div><div class="bar-track"><i class="color-${i % 4}" style="width:${Math.max(0, (Number(c.net_total) / maxCategory) * 100)}%"></i></div><small>${Number(c.qty)} وحدة مباعة</small></div>`).join("") : `<div class="chart-empty">${d.icon("reports")}<strong>اليوم يبدأ بفرصة جديدة</strong><p>ستظهر مقارنة الفئات بعد أول عملية بيع اليوم.</p><div class="empty-bars"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>`}</div></section>
  <section class="report-section payment-panel"><div class="panel-heading"><div><span class="eyebrow">توزيع التحصيل</span><h2>قنوات الدفع</h2></div>${d.icon("accounting")}</div><div class="payment-donut" role="img" aria-label="إجمالي التحصيل ${UI.escape(UI.money(total))}، النقد ${ratio.toFixed(1)} بالمئة" style="--cash:${ratio}%;--ring:${total ? "#7995bb" : "#e9efed"}"><div><small>إجمالي التحصيل</small><strong class="money">${UI.money(total)}</strong></div></div><div class="payment-legend">${[
    ["cash", "نقدًا", "teal"],
    ["knet", "كي نت", "blue"],
  ]
    .map(
      ([key, label, color]) =>
        `<div><span><i class="legend-dot ${color}"></i>${label}</span><b class="money">${UI.money(data.payments.find((p) => p.payment_method === key)?.amount || 0)}</b></div>`,
    )
    .join("")}</div></section></div>
  <section class="quick-actions">${shortcuts.map(([key, label]) => `<button data-shortcut="${key}"><i>${d.icon(key)}</i><span>${label}<small>${d.descriptions[key]}</small></span>${d.icon("arrow")}</button>`).join("")}</section>
  <section class="report-section"><div class="panel-heading"><div><span class="eyebrow">فريق العمل</span><h2>مبيعات اليوم حسب الكاشير</h2></div><span class="panel-tag">${data.cashiers.length} كاشير</span></div>${this.table(
    data.cashiers,
    [
      ["full_name", "الكاشير"],
      ["invoice_count", "الفواتير"],
      ["net_total", "المبيعات", "money"],
    ],
  )}</section>`;
  for (const button of UI.$("adminContent").querySelectorAll("[data-shortcut]"))
    button.onclick = () => this.load(button.dataset.shortcut);
};

const originalSettings = Admin.settings;
Admin.settings = async function () {
  await originalSettings.call(this);
  if (this.section !== "settings") return;
  const form = UI.$("settingsForm");
  const container = form.parentElement;
  container.className = "settings-panel";
  container.insertAdjacentHTML(
    "beforebegin",
    `<div class="settings-banner">${AdminDesign.icon("settings")}<div><strong>تفاصيل تحمل هويتك</strong><p>اجعل كل فاتورة تعكس اسم الفرع وبياناته بوضوح.</p></div></div>`,
  );
  container.insertAdjacentHTML(
    "afterend",
    '<aside class="receipt-preview"><span class="eyebrow">معاينة بيانات الفرع</span><div id="branchPreview"></div><small>معاينة نصية للبيانات قبل الحفظ</small></aside>',
  );
  const preview = () => {
    const values = Object.fromEntries(new FormData(form));
    UI.$("branchPreview").innerHTML =
      `${AdminDesign.icon("receipt")}<h3>${UI.escape(values.branch_name || "اسم الفرع")}</h3><p>${UI.escape(values.branch_address || "عنوان الفرع")}</p><p dir="ltr">${UI.escape(values.branch_phone || "—")}</p><div class="preview-separator"></div><small>${UI.escape(values.return_policy || "سياسة الاسترجاع")}</small>`;
  };
  form.addEventListener("input", preview);
  preview();
};

const originalImport = Admin.importPage;
Admin.importPage = function () {
  originalImport.call(this);
  UI.$("importForm").insertAdjacentHTML(
    "afterbegin",
    `<div class="import-symbol">${AdminDesign.icon("import")}</div><h2>بياناتك، جاهزة للانطلاق</h2>`,
  );
};
