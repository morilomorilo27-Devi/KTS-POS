window.Admin = {
  section: "dashboard",
  rows: [],
  sections: [
    ["dashboard", "نظرة عامة", "reports_view"],
    ["exceptions", "التنبيهات والاستثناءات", "reports_view"],
    ["products", "الأصناف", "catalog_manage"],
    ["categories", "فئات الأصناف", "catalog_manage"],
    ["inventory", "المخزون والجرد", "inventory_manage"],
    ["movements", "حركات المخزون", "inventory_manage"],
    ["suppliers", "الموردون", "suppliers_manage"],
    ["purchases", "التوريد والمشتريات", "suppliers_manage"],
    ["reorder", "إعادة الطلب الذكية", "inventory_manage"],
    ["procurement-requests", "طلبات وعروض الشراء", "suppliers_manage"],
    ["purchase-orders", "أوامر الشراء والاستلام", "suppliers_manage"],
    ["supplier-invoices", "فواتير الموردين", "suppliers_manage"],
    ["cycle-counts", "الجرد الدوري ABC", "inventory_manage"],
    ["members", "الأعضاء", "members_manage"],
    ["member-benefits", "مزايا العضوية", "members_manage"],
    ["discounts", "قواعد الخصم", "discounts_manage"],
    ["shifts", "الورديات", "shifts_manage"],
    ["schedules", "جداول الدوام", "shifts_manage"],
    ["reports", "تقارير المبيعات", "reports_view"],
    ["accounting", "المحاسبة الداخلية", "reports_view"],
    ["journal", "القيود اليومية", "reports_view"],
    ["audit", "سجل التدقيق", "audit_view"],
    ["users", "المستخدمون", "users_manage"],
    ["import", "استيراد البيانات", "import_data"],
    ["settings", "إعدادات الفاتورة", "settings_manage"],
    ["devices", "أجهزة نقطة البيع", "settings_manage"],
    ["backups", "النسخ الاحتياطي", "settings_manage"],
  ],
  async init() {
    const sidebar = UI.$("adminSidebar");
    sidebar.innerHTML = "";
    for (const [key, label, permission] of this.sections.filter((s) =>
      Auth.can(s[2]),
    )) {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.section = key;
      b.onclick = () => this.load(key);
      sidebar.append(b);
    }
    if (!this.sections.some((s) => s[0] === this.section && Auth.can(s[2])))
      this.section = this.sections.find((s) => Auth.can(s[2]))?.[0];
    await this.load(this.section);
  },
  async load(section) {
    this.section = section;
    this.tablePage = 1;
    const item = this.sections.find((s) => s[0] === section);
    if (!item || !Auth.can(item[2])) return;
    for (const b of UI.$("adminSidebar").querySelectorAll("[data-section]")) {
      b.classList.toggle("active", b.dataset.section === section);
      if (b.dataset.section === section) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    UI.$("adminHeading").innerHTML = AdminDesign.heading(section, item[1]);
    UI.$("adminContent").dataset.adminSection = section;
    UI.$("adminToolbar").innerHTML = "";
    UI.$("adminContent").innerHTML =
      '<div class="skeleton" aria-label="جارٍ تحميل البيانات"></div>';
    try {
      if (section === "dashboard") return await this.dashboard();
      if (section === "reports") return await this.reports();
      if (section === "accounting") return await this.accounting();
      if (section === "journal") return await this.journal();
      if (section === "import") return this.importPage();
      if (section === "settings") return await this.settings();
      const path =
        {
          movements: "/inventory/movements",
          audit: "/audit",
          schedules: "/shifts/schedules",
        }[section] || "/" + section;
      const rows = await API.request(path);
      if (this.section !== section) return;
      this.rows = rows;
      const columns = {
        products: [
          ["sku", "SKU"],
          ["name_ar", "الصنف"],
          ["category_name", "الفئة"],
          ["supplier_names", "الموردون"],
          ["sale_price", "سعر البيع", "money"],
          ["cost_price", "التكلفة", "money"],
          ["qty_on_hand", "المخزون"],
          ["status", "الحالة"],
        ],
        categories: [
          ["code", "الرمز"],
          ["name_ar", "الفئة"],
          ["name_en", "الاسم الإنجليزي"],
          ["products_count", "عدد الأصناف"],
          ["status", "الحالة"],
        ],
        inventory: [
          ["sku", "SKU"],
          ["name_ar", "الصنف"],
          ["qty_on_hand", "المتاح"],
          ["qty_reserved", "المحجوز"],
          ["min_stock_alert", "حد التنبيه"],
          ["cost_price", "التكلفة", "money"],
          ["stock_value", "قيمة المخزون", "money"],
        ],
        movements: [
          ["created_at", "التاريخ"],
          ["name_ar", "الصنف"],
          ["movement_type", "نوع الحركة"],
          ["qty_change", "الكمية"],
          ["balance_after", "الرصيد"],
          ["full_name", "المستخدم"],
          ["notes", "السبب"],
        ],
        suppliers: [
          ["code", "الرمز"],
          ["name", "المورد"],
          ["contact_person", "مسؤول الاتصال"],
          ["phone", "الهاتف"],
          ["balance_due", "الرصيد المستحق", "money"],
          ["status", "الحالة"],
        ],
        purchases: [
          ["purchase_no", "رقم التوريد"],
          ["supplier_name", "المورد"],
          ["total", "الإجمالي", "money"],
          ["paid_amount", "المدفوع", "money"],
          ["payment_method", "طريقة الدفع"],
          ["created_at", "التاريخ"],
        ],
        members: [
          ["membership_no", "العضوية"],
          ["civil_id", "المدني"],
          ["name", "الاسم"],
          ["category_name", "الفئة"],
          ["phone", "الهاتف"],
          ["status", "الحالة"],
        ],
        discounts: [
          ["code", "الرمز"],
          ["name_ar", "الخصم"],
          ["type", "النوع"],
          ["value", "القيمة"],
          ["scope", "النطاق"],
          ["priority", "الأولوية"],
          ["status", "الحالة"],
        ],
        shifts: [
          ["shift_no", "الوردية"],
          ["full_name", "الكاشير"],
          ["opening_cash", "الافتتاح", "money"],
          ["total_sales", "صافي المبيعات", "money"],
          ["total_refunds", "المرتجعات", "money"],
          ["discrepancy", "الفارق", "money"],
          ["status", "الحالة"],
          ["opened_at", "الافتتاح"],
        ],
        schedules: [
          ["full_name", "الكاشير"],
          ["day_of_week", "اليوم"],
          ["shift_type", "الفترة"],
          ["start_time", "من"],
          ["end_time", "إلى"],
          ["is_active", "يوم عمل"],
        ],
        audit: [
          ["created_at", "التاريخ"],
          ["full_name", "المستخدم"],
          ["action", "العملية"],
          ["entity_type", "الكيان"],
          ["entity_id", "المرجع"],
          ["ip_address", "IP"],
          ["old_values", "قبل", "json"],
          ["new_values", "بعد", "json"],
        ],
        users: [
          ["username", "اسم المستخدم"],
          ["full_name", "الاسم"],
          ["role_name_ar", "الدور"],
          ["access_mode", "الصلاحيات"],
          ["phone", "الهاتف"],
          ["status", "الحالة"],
        ],
      };
      this.columns = columns[section];
      this.toolbar(section);
      this.drawTable();
    } catch (e) {
      if (this.section !== section) return;
      UI.$("adminContent").innerHTML =
        `<div class="empty-state"><strong>تعذر تحميل البيانات</strong><p>${UI.escape(e.message)}</p><button id="retryAdmin">إعادة المحاولة</button></div>`;
      UI.$("retryAdmin").onclick = () => this.load(section);
    }
  },
  toolbar(section) {
    const el = UI.$("adminToolbar");
    el.innerHTML =
      '<input id="adminSearch" type="search" placeholder="بحث في البيانات المعروضة">';
    UI.$("adminSearch").oninput = () => {
      this.tablePage = 1;
      this.drawTable();
    };
    if (
      [
        "products",
        "categories",
        "members",
        "suppliers",
        "discounts",
        "users",
        "schedules",
      ].includes(section)
    ) {
      const b = document.createElement("button");
      b.className = "primary";
      b.textContent = "إضافة جديد";
      b.onclick = () => this.edit(section);
      el.append(b);
    }
    if (section === "inventory") {
      const b = document.createElement("button");
      b.className = "primary";
      b.textContent = "تسجيل حركة جرد";
      b.onclick = () => this.adjust();
      el.append(b);
      const total = document.createElement("span");
      total.textContent =
        "قيمة المخزون: " +
        UI.money(this.rows.reduce((s, p) => s + p.stock_value, 0));
      el.append(total);
    }
    if (section === "purchases") {
      const b = document.createElement("button");
      b.className = "primary";
      b.textContent = "تسجيل توريد";
      b.onclick = () => this.purchase();
      el.append(b);
    }
    if (section === "suppliers") {
      const b = document.createElement("button");
      b.textContent = "سداد مورد";
      b.onclick = () => this.supplierPayment();
      el.append(b);
    }
  },
  table(rows, columns, actions) {
    return `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${c[1]}</th>`).join("")}${actions ? "<th>الإجراء</th>" : ""}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map(([k, label, type]) => `<td class="${type === "money" ? "money" : ""}">${type === "money" ? UI.money(r[k]) : type === "json" ? "<pre>" + UI.escape(r[k]) + "</pre>" : UI.escape(this.display(k, r[k]))}</td>`).join("")}${actions ? "<td>" + actions(r) + "</td>" : ""}</tr>`).join("")}</tbody></table>${rows.length ? "" : '<div class="empty-state">لا توجد بيانات</div>'}</div>`;
  },
  display(key, value) {
    const enums = {
      active: "فعال",
      inactive: "غير فعال",
      expired: "منتهية",
      suspended: "موقوفة",
      open: "مفتوحة",
      closed: "مغلقة",
      completed: "مكتملة",
      refunded: "مسترجعة",
      partial_refunded: "مسترجعة جزئيًا",
      cash: "نقدًا",
      knet: "كي نت",
      morning: "صباحي",
      evening: "مسائي",
      full: "كامل",
      sale: "بيع",
      return: "مرتجع",
      purchase: "توريد",
      initial: "افتتاحي",
      adjustment: "تسوية",
      percentage: "مئوي",
      fixed_amount: "مبلغ ثابت",
      all: "كل الأصناف",
      membership_category: "فئة العضوية",
      member: "عضو محدد",
      category: "فئة الأصناف",
      product: "صنف محدد",
      asset: "أصول",
      liability: "التزامات",
      equity: "حقوق الملكية",
      income: "إيرادات",
      contra_income: "مردودات",
      expense: "مصروفات",
    };
    if (key === "day_of_week")
      return [
        "الأحد",
        "الاثنين",
        "الثلاثاء",
        "الأربعاء",
        "الخميس",
        "الجمعة",
        "السبت",
      ][value];
    if (key === "is_active") return Number(value) ? "نعم" : "راحة";
    return enums[value] || (value ?? "");
  },
  drawTable() {
    const query = UI.$("adminSearch")?.value.toLocaleLowerCase() || "";
    const rows = this.rows.filter((r) =>
      Object.values(r).some((v) =>
        String(v ?? "")
          .toLocaleLowerCase()
          .includes(query),
      ),
    );
    const editable = [
      "products",
      "categories",
      "members",
      "suppliers",
      "discounts",
      "users",
      "schedules",
    ].includes(this.section);
    const actions = editable
      ? (r) =>
          `<button data-edit="${UI.escape(r.id)}">تعديل</button>${this.section === "products" ? `<button class="text-danger" data-delete="${UI.escape(r.id)}">تعطيل</button>` : ""}${this.section === "suppliers" ? `<button data-supplier-products="${UI.escape(r.id)}">الأصناف المرتبطة</button>` : ""}`
      : this.section === "shifts"
        ? (r) =>
            `<button data-shift="${UI.escape(r.id)}">تقرير ${r.status === "closed" ? "Z" : "X"}</button>`
        : null;
    this.filteredCount = rows.length;
    this.tablePage = Math.min(
      this.tablePage || 1,
      Math.max(1, Math.ceil(rows.length / 20)),
    );
    UI.$("adminContent").innerHTML = this.table(
      rows.slice((this.tablePage - 1) * 20, this.tablePage * 20),
      this.columns,
      actions,
    );
    for (const b of document.querySelectorAll("[data-edit]"))
      b.onclick = () =>
        this.edit(
          this.section,
          this.rows.find((r) => r.id === b.dataset.edit),
        );
    for (const b of document.querySelectorAll("[data-delete]"))
      b.onclick = () => {
        const dialog = UI.modal(
          "تعطيل الصنف",
          '<p>سيتم إيقاف الصنف عن البيع مع الاحتفاظ بسجل عملياته.</p><footer><button data-close>إلغاء</button><button id="confirmDelete" class="primary">تعطيل الصنف</button></footer>',
        );
        UI.$("confirmDelete").onclick = async () => {
          try {
            await API.request("/products/" + b.dataset.delete, "DELETE");
            dialog.close();
            await this.load("products");
            await POS.snapshot();
          } catch (e) {
            UI.toast(e.message, true);
          }
        };
      };
    for (const b of document.querySelectorAll("[data-shift]"))
      b.onclick = () => this.shiftReport(b.dataset.shift);
    for (const b of document.querySelectorAll("[data-supplier-products]"))
      b.onclick = async () => {
        try {
          const rows = await API.request(
            "/suppliers/" + b.dataset.supplierProducts + "/products",
          );
          UI.modal(
            "أصناف المورد",
            this.table(rows, [
              ["sku", "SKU"],
              ["name_ar", "الصنف"],
              ["cost_price", "التكلفة", "money"],
            ]),
          );
        } catch (e) {
          UI.toast(e.message, true);
        }
      };
    if (this.section === "inventory") {
      UI.$("adminToolbar").querySelector("[data-damaged]")?.remove();
      const damaged = document.createElement("button");
      damaged.dataset.damaged = "true";
      damaged.textContent = "المخزون التالف";
      damaged.onclick = async () => {
        try {
          UI.modal(
            "المرتجعات التالفة",
            this.table(await API.request("/inventory/damaged"), [
              ["sku", "SKU"],
              ["name_ar", "الصنف"],
              ["qty", "الكمية التالفة"],
            ]),
          );
        } catch (e) {
          UI.toast(e.message, true);
        }
      };
      UI.$("adminToolbar").append(damaged);
    }
  },
  field(
    name,
    label,
    type = "text",
    options = [],
    required = false,
    value = "",
  ) {
    return { name, label, type, options, required, value };
  },
  async edit(section, row = {}) {
    try {
      const f = (...args) => this.field(...args);
      const states = [
        ["active", "فعال"],
        ["inactive", "غير فعال"],
      ];
      let fields = [];
      if (section === "products") {
        const [categories, suppliers] = await Promise.all([
          API.request("/categories"),
          API.request("/catalog/supplier-options"),
        ]);
        fields = [
          f("sku", "SKU", "text", [], true),
          f("name_ar", "اسم الصنف", "text", [], true),
          f("name_en", "الاسم الإنجليزي"),
          f(
            "category_id",
            "الفئة",
            "select",
            categories.map((c) => [c.id, c.name_ar]),
            true,
          ),
          f("sale_price", "سعر البيع", "number", [], true),
          f("cost_price", "التكلفة", "number", [], false, 0),
          f("min_stock_alert", "حد تنبيه المخزون", "number", [], false, 5),
          f("unit", "الوحدة", "text", [], false, "قطعة"),
          f(
            "is_discountable",
            "مؤهل للخصم",
            "select",
            [
              [1, "نعم"],
              [0, "لا"],
            ],
            false,
            1,
          ),
          f("barcodes", "الباركودات — تفصل بعلامة |"),
          f(
            "supplier_ids",
            "الموردون المرتبطون بالصنف",
            "multiselect",
            suppliers.map((supplier) => [
              supplier.id,
              supplier.name,
              supplier.code +
                (supplier.status === "inactive" ? " · غير فعال" : ""),
            ]),
          ),
          f("image", "رفع صورة", "file"),
          f("status", "الحالة", "select", states, false, "active"),
        ];
        if (!row.id)
          fields.push(
            f("initial_qty", "المخزون الأولي", "number", [], false, 0),
          );
      }
      if (section === "categories") {
        const cats = await API.request("/categories");
        fields = [
          f("code", "رمز الفئة", "text", [], true),
          f("name_ar", "الاسم العربي", "text", [], true),
          f("name_en", "الاسم الإنجليزي"),
          f("parent_id", "الفئة الأب", "select", [
            ["", "دون فئة أب"],
            ...cats
              .filter((c) => c.id !== row.id)
              .map((c) => [c.id, c.name_ar]),
          ]),
          f("image_url", "رابط الصورة", "url"),
          f("image", "رفع صورة", "file"),
          f("status", "الحالة", "select", states, false, "active"),
        ];
      }
      if (section === "members") {
        const cats = await API.request("/membership-categories");
        fields = [
          f("membership_no", "رقم العضوية", "text", [], true),
          f("civil_id", "الرقم المدني", "text", [], true),
          f("name", "اسم العضو", "text", [], true),
          f(
            "category_id",
            "فئة العضوية",
            "select",
            cats.map((c) => [c.id, c.name_ar]),
            true,
          ),
          f("phone", "الهاتف"),
          f("email", "البريد", "email"),
          f("workplace", "جهة العمل"),
          f(
            "is_eligible_for_discount",
            "أهلية الخصم",
            "select",
            [
              [1, "مؤهل"],
              [0, "غير مؤهل"],
            ],
            false,
            1,
          ),
          f(
            "status",
            "الحالة",
            "select",
            [
              ...states.filter((s) => s[0] === "active"),
              ["expired", "منتهية"],
              ["suspended", "موقوفة"],
            ],
            false,
            "active",
          ),
        ];
      }
      if (section === "suppliers")
        fields = [
          f("code", "رمز المورد", "text", [], true),
          f("name", "اسم المورد", "text", [], true),
          f("contact_person", "مسؤول الاتصال"),
          f("phone", "الهاتف"),
          f("email", "البريد", "email"),
          f("address", "العنوان"),
          f("status", "الحالة", "select", states, false, "active"),
        ];
      if (section === "discounts") {
        const [cats, products, mcats, members] = await Promise.all([
          API.request("/categories"),
          API.request("/lookups/products"),
          API.request("/membership-categories"),
          API.request("/members"),
        ]);
        fields = [
          f("code", "رمز القاعدة", "text", [], true),
          f("name_ar", "اسم الخصم", "text", [], true),
          f(
            "type",
            "النوع",
            "select",
            [
              ["percentage", "مئوي"],
              ["fixed_amount", "مبلغ ثابت لكل وحدة"],
            ],
            true,
            "percentage",
          ),
          f("value", "القيمة", "number", [], true),
          f("priority", "الأولوية", "number", [], false, 10),
          f(
            "scope",
            "النطاق",
            "select",
            [
              ["all", "عام"],
              ["membership_category", "فئة العضوية"],
              ["member", "عضو"],
              ["category", "فئة صنف"],
              ["product", "صنف"],
            ],
            true,
            "membership_category",
          ),
          f(
            "target_membership_category_id",
            "فئة العضوية المستهدفة",
            "select",
            [["", "—"], ...mcats.map((c) => [c.id, c.name_ar])],
          ),
          f("target_member_id", "العضو المستهدف", "select", [
            ["", "—"],
            ...members.map((c) => [c.id, c.name]),
          ]),
          f("target_category_id", "فئة الصنف المستهدفة", "select", [
            ["", "—"],
            ...cats.map((c) => [c.id, c.name_ar]),
          ]),
          f("target_product_id", "الصنف المستهدف", "select", [
            ["", "—"],
            ...products.map((c) => [c.id, c.name_ar]),
          ]),
          f("min_spend", "الحد الأدنى للفاتورة", "number", [], false, 0),
          f("max_discount", "سقف الخصم", "number"),
          f(
            "can_combine",
            "السماح بالجمع",
            "select",
            [
              [0, "لا"],
              [1, "نعم"],
            ],
            false,
            0,
          ),
          f("start_date", "تاريخ البداية", "date"),
          f("end_date", "تاريخ النهاية", "date"),
          f("status", "الحالة", "select", states, false, "active"),
        ];
      }
      if (section === "users") {
        const roles = await API.request("/roles");
        fields = [
          f("username", "اسم المستخدم", "text", [], true),
          f("full_name", "الاسم الكامل", "text", [], true),
          f(
            "password",
            row.id ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور",
            "password",
            [],
            !row.id,
          ),
          f(
            "role_id",
            "الدور",
            "select",
            roles.map((r) => [r.id, r.name_ar]),
            true,
          ),
          f("phone", "الهاتف"),
          f("email", "البريد", "email"),
          f("status", "الحالة", "select", states, false, "active"),
        ];
      }
      if (section === "schedules") {
        const users = await API.request("/shifts/cashiers");
        fields = [
          f(
            "user_id",
            "المستخدم",
            "select",
            users.map((u) => [u.id, u.full_name]),
            true,
          ),
          f(
            "day_of_week",
            "اليوم",
            "select",
            [
              "الأحد",
              "الاثنين",
              "الثلاثاء",
              "الأربعاء",
              "الخميس",
              "الجمعة",
              "السبت",
            ].map((v, i) => [i, v]),
            true,
            0,
          ),
          f(
            "shift_type",
            "الفترة",
            "select",
            [
              ["morning", "صباحي"],
              ["evening", "مسائي"],
              ["full", "كامل"],
            ],
            true,
            "morning",
          ),
          f("start_time", "البداية", "time", [], false, "08:00"),
          f("end_time", "النهاية", "time", [], false, "15:00"),
          f(
            "is_active",
            "يوم العمل",
            "select",
            [
              [1, "عمل"],
              [0, "راحة"],
            ],
            false,
            1,
          ),
          f("notes", "ملاحظات"),
        ];
      }
      const dialog = this.form(
        (row.id ? "تعديل" : "إضافة") +
          " " +
          this.sections.find((s) => s[0] === section)[1],
        fields,
        { ...row, barcodes: row.barcodes?.join("|") },
        async (form) => {
          let body;
          if (["products", "categories"].includes(section)) {
            body = form;
            if (section === "products") {
              body.set(
                "barcodes",
                JSON.stringify(
                  String(body.get("barcodes") || "")
                    .split("|")
                    .filter(Boolean),
                ),
              );
              const supplierIds = body.getAll("supplier_ids");
              body.delete("supplier_ids");
              body.set("supplier_ids", JSON.stringify(supplierIds));
            }
            if (!body.get("image")?.size) body.delete("image");
          } else {
            body = Object.fromEntries(form);
            if (section === "users" && !body.password) delete body.password;
            if (section === "schedules" && row.id) body.id = row.id;
          }
          const path =
            section === "schedules"
              ? "/shifts/schedules"
              : "/" + section + (row.id ? "/" + row.id : "");
          await API.request(
            path,
            section === "schedules" ? "POST" : row.id ? "PUT" : "POST",
            body,
          );
          await this.load(section);
          if (
            ["products", "categories", "members", "discounts"].includes(section)
          )
            await POS.snapshot();
        },
      );
      if (section === "schedules") {
        const select = dialog.querySelector("[name=shift_type]");
        select.onchange = () => {
          const hours = {
            morning: ["08:00", "15:00"],
            evening: ["15:00", "22:00"],
            full: ["08:00", "22:00"],
          }[select.value];
          dialog.querySelector("[name=start_time]").value = hours[0];
          dialog.querySelector("[name=end_time]").value = hours[1];
        };
      }
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  form(title, fields, row, onSubmit) {
    const dialog = UI.modal(
      title,
      `<form id="entityForm"><div class="form-grid">${fields
        .map((f) => {
          let value = row[f.name] ?? f.value;
          if (f.type === "number" && value !== "" && value != null)
            value = UI.round(value);
          if (f.type === "multiselect") {
            const selected = new Set(
              (Array.isArray(value) ? value : []).map(String),
            );
            return `<div class="supplier-picker"><span class="supplier-picker-label">${UI.escape(f.label)}</span><details><summary><span class="supplier-selection-text">${selected.size ? `${selected.size} مورد محدد` : "اختر الموردين"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary><div class="supplier-options">${f.options.length ? f.options.map(([id, label, meta]) => `<label><input type="checkbox" name="${f.name}" value="${UI.escape(id)}" ${selected.has(String(id)) ? "checked" : ""}><span><strong>${UI.escape(label)}</strong><small>${UI.escape(meta || "")}</small></span></label>`).join("") : '<div class="supplier-picker-empty">لا يوجد موردون بعد. أضف موردًا أولًا من قسم الموردين.</div>'}</div></details><small class="supplier-picker-help">يمكن اختيار أكثر من مورد، أو ترك القائمة دون تحديد.</small></div>`;
          }
          return `<label>${f.label}${f.required ? " *" : ""}${f.type === "select" ? `<select name="${f.name}" ${f.required ? "required" : ""}>${f.options.map(([v, label]) => `<option value="${UI.escape(v)}" ${String(v) === String(value) ? "selected" : ""}>${UI.escape(label)}</option>`).join("")}</select>` : f.type === "textarea" ? `<textarea name="${f.name}" ${f.required ? "required" : ""}>${UI.escape(value)}</textarea>` : `<input name="${f.name}" type="${f.type}" ${f.type === "file" ? 'accept="image/png,image/jpeg,image/webp"' : `value="${UI.escape(value)}"`} ${f.type === "number" ? 'min="0" step="0.001"' : ""} ${f.required ? "required" : ""}>`}</label>`;
        })
        .join(
          "",
        )}</div><div id="entityError" class="error" role="alert"></div><footer><button type="button" data-close>إلغاء</button><button class="primary" type="submit">حفظ</button></footer></form>`,
    );
    const supplierPicker = dialog.querySelector(".supplier-picker");
    if (supplierPicker) {
      const updateSupplierSummary = () => {
        const count = supplierPicker.querySelectorAll(
          'input[type="checkbox"]:checked',
        ).length;
        supplierPicker.querySelector(".supplier-selection-text").textContent =
          count ? `${count} مورد محدد` : "اختر الموردين";
      };
      supplierPicker.addEventListener("change", updateSupplierSummary);
    }
    UI.$("entityForm").onsubmit = async (e) => {
      e.preventDefault();
      const button = e.target.querySelector(".primary");
      button.disabled = true;
      try {
        await onSubmit(new FormData(e.target));
        dialog.close();
        UI.toast("تم الحفظ");
      } catch (err) {
        UI.$("entityError").textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
    return dialog;
  },
  async dashboard() {
    const data = await API.request("/reports/dashboard");
    UI.$("adminContent").innerHTML = `<div class="metrics">${[
      ["صافي مبيعات اليوم", UI.money(data.net_after_refunds)],
      ["عدد الفواتير", data.invoice_count],
      ["أصناف منخفضة المخزون", data.low_stock],
      ["الورديات المفتوحة", data.open_shifts],
    ]
      .map(
        ([k, v]) =>
          `<div class="metric"><small>${k}</small><strong class="money">${v}</strong></div>`,
      )
      .join(
        "",
      )}</div><section class="report-section"><h2>مبيعات اليوم حسب الكاشير</h2>${this.table(
      data.cashiers,
      [
        ["full_name", "الكاشير"],
        ["invoice_count", "الفواتير"],
        ["net_total", "المبيعات", "money"],
      ],
    )}</section><section class="report-section"><h2>قنوات التحصيل</h2>${this.table(
      data.payments,
      [
        ["payment_method", "طريقة الدفع"],
        ["amount", "التحصيل", "money"],
      ],
    )}</section>`;
  },
  async reports() {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuwait",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    UI.$("adminToolbar").innerHTML =
      `<label>من<input id="reportFrom" type="date" value="${today}"></label><label>إلى<input id="reportTo" type="date" value="${today}"></label><button id="runReport" class="primary">عرض التقرير</button><button id="excelDaily">تصدير يومي Excel</button><button id="excelSummary">تصدير تجميعي Excel</button>`;
    const load = async () => {
      try {
        const from = UI.$("reportFrom").value,
          to = UI.$("reportTo").value;
        if (from > to) throw new Error("الفترة غير صالحة");
        const [daily, summary] = await Promise.all([
          API.request("/reports/sales-daily?date=" + from),
          API.request(`/reports/sales-summary?from=${from}&to=${to}`),
        ]);
        if (this.section !== "reports") return;
        UI.$("adminContent").innerHTML = `<div class="metrics">${[
          ["إجمالي المبيعات", summary.net_total],
          ["الخصومات", summary.discount_total],
          ["المردودات", summary.refunds],
          ["الصافي بعد المرتجعات", summary.net_after_refunds],
        ]
          .map(
            ([k, v]) =>
              `<div class="metric"><small>${k}</small><strong class="money">${UI.money(v)}</strong></div>`,
          )
          .join(
            "",
          )}</div><section class="report-section"><h2>فواتير يوم ${from}</h2>${this.table(
          daily,
          [
            ["invoice_no", "الفاتورة"],
            ["cashier_name", "الكاشير"],
            ["created_at", "التاريخ"],
            ["net_total", "الصافي", "money"],
            ["refunds", "المرتجعات", "money"],
            ["status", "الحالة"],
          ],
          (r) => `<button data-invoice="${UI.escape(r.id)}">الفاتورة</button>`,
        )}</section><section class="report-section"><h2>حسب الكاشير</h2>${this.table(
          summary.cashiers,
          [
            ["full_name", "الكاشير"],
            ["invoice_count", "الفواتير"],
            ["net_total", "المبيعات", "money"],
          ],
        )}</section><section class="report-section"><h2>حسب الفئة</h2>${this.table(
          summary.categories,
          [
            ["name_ar", "الفئة"],
            ["qty", "الكمية"],
            ["net_total", "المبيعات", "money"],
          ],
        )}</section><section class="report-section"><h2>حسب التحصيل</h2>${this.table(
          summary.payments,
          [
            ["payment_method", "الدفع"],
            ["amount", "المبلغ", "money"],
          ],
        )}</section>`;
        AdminDesign.decorate();
        for (const b of document.querySelectorAll("[data-invoice]"))
          b.onclick = async () => {
            try {
              POS.receipt(
                await API.request("/pos/invoices/" + b.dataset.invoice),
              );
            } catch (e) {
              UI.toast(e.message, true);
            }
          };
      } catch (e) {
        UI.toast(e.message, true);
      }
    };
    UI.$("runReport").onclick = load;
    UI.$("excelDaily").onclick = () =>
      UI.download(
        "/reports/export-excel?type=daily&date=" + UI.$("reportFrom").value,
        "KTS-Daily.xlsx",
      ).catch((e) => UI.toast(e.message, true));
    UI.$("excelSummary").onclick = () =>
      UI.download(
        `/reports/export-excel?type=summary&from=${UI.$("reportFrom").value}&to=${UI.$("reportTo").value}`,
        "KTS-Summary.xlsx",
      ).catch((e) => UI.toast(e.message, true));
    await load();
  },
  async accounting() {
    const rows = await API.request("/accounting/accounts");
    if (this.section !== "accounting") return;
    const totalD = UI.round(rows.reduce((s, r) => s + r.debit, 0)),
      totalC = UI.round(rows.reduce((s, r) => s + r.credit, 0));
    const income = rows
      .filter((r) => r.type === "income")
      .reduce((s, r) => s - r.balance, 0);
    const returns = rows
      .filter((r) => r.type === "contra_income")
      .reduce((s, r) => s + r.balance, 0);
    const expenses = rows
      .filter((r) => r.type === "expense")
      .reduce((s, r) => s + r.balance, 0);
    UI.$("adminContent").innerHTML = `<div class="metrics">${[
      ["إيرادات المبيعات", income],
      ["المردودات", returns],
      ["المصروفات والتكلفة", expenses],
      ["نتيجة التشغيل", income - returns - expenses],
    ]
      .map(
        ([k, v]) =>
          `<div class="metric"><small>${k}</small><strong class="money">${UI.money(v)}</strong></div>`,
      )
      .join(
        "",
      )}</div><h2 style="margin-bottom:16px">ميزان المراجعة</h2>${this.table(
      rows,
      [
        ["code", "الحساب"],
        ["name_ar", "اسم الحساب"],
        ["type", "النوع"],
        ["debit", "المدين", "money"],
        ["credit", "الدائن", "money"],
        ["balance", "الرصيد", "money"],
      ],
    )}<p>إجمالي المدين: ${UI.money(totalD)} · إجمالي الدائن: ${UI.money(totalC)} · الفارق: ${UI.money(totalD - totalC)}</p>`;
  },
  async journal(page = 1) {
    const result = await API.request("/accounting/journal?page=" + page);
    const entries = result.rows;
    if (this.section !== "journal") return;
    UI.$("adminContent").innerHTML = entries.length
      ? entries
          .map(
            (e) =>
              `<section class="report-section"><h2>${UI.escape(e.entry_no)} · ${UI.escape(e.description)}</h2><p>${UI.escape(e.created_at)} · ${UI.escape(e.full_name)} · ${UI.escape(e.reference_type)}</p>${this.table(
                e.lines,
                [
                  ["account_code", "الحساب"],
                  ["name_ar", "الاسم"],
                  ["debit", "مدين", "money"],
                  ["credit", "دائن", "money"],
                ],
              )}</section>`,
          )
          .join("")
      : '<div class="empty-state">لا توجد قيود بعد</div>';
    if (Auth.can("journal_create")) {
      UI.$("adminToolbar").innerHTML =
        '<button class="primary" id="manualJournal">قيد يومي يدوي</button>';
      UI.$("manualJournal").onclick = () => this.manualJournal();
    }
    UI.$("adminToolbar").insertAdjacentHTML("beforeend", `<button id="journalPrev" ${page <= 1 ? "disabled" : ""}>السابق</button><span>صفحة ${page} · ${result.total} قيد</span><button id="journalNext" ${page * result.limit >= result.total ? "disabled" : ""}>التالي</button>`);
    UI.$("journalPrev").onclick = () => this.journal(page - 1);
    UI.$("journalNext").onclick = () => this.journal(page + 1);
  },
  async manualJournal() {
    const accounts = await API.request("/lookups/accounts");
    this.form(
      "قيد يومي يدوي",
      [
        this.field("description", "البيان", "text", [], true),
        this.field(
          "debit_account",
          "الحساب المدين",
          "select",
          accounts.map((a) => [a.code, a.name_ar]),
          true,
        ),
        this.field(
          "credit_account",
          "الحساب الدائن",
          "select",
          accounts.map((a) => [a.code, a.name_ar]),
          true,
        ),
        this.field("amount", "المبلغ", "number", [], true),
      ],
      {},
      async (f) => {
        const body = Object.fromEntries(f);
        await API.request("/accounting/journal", "POST", body);
        await this.load("journal");
      },
    );
  },
  async adjust() {
    const products = await API.request("/lookups/products");
    const dialog = this.form(
      "حركة المخزون",
      [
        this.field(
          "product_id",
          "الصنف",
          "select",
          products.map((p) => [p.id, p.name_ar + " — " + p.qty_on_hand]),
          true,
        ),
        this.field(
          "movement_type",
          "النوع",
          "select",
          [
            ["adjustment", "تسوية جرد"],
            ["initial", "رصيد افتتاحي"],
          ],
          true,
          "adjustment",
        ),
        this.field(
          "direction",
          "اتجاه الحركة",
          "select",
          [
            [1, "إضافة"],
            [-1, "خصم"],
          ],
          true,
          1,
        ),
        this.field("quantity", "الكمية", "number", [], true),
        this.field("notes", "السبب", "text", [], true),
      ],
      {},
      async (f) => {
        const body = Object.fromEntries(f);
        body.qty_change = Number(body.quantity) * Number(body.direction);
        await API.request("/inventory/adjust", "POST", body);
        await this.load("inventory");
        await POS.snapshot();
      },
    );
    return dialog;
  },
  async purchase() {
    try {
      const [suppliers, products] = await Promise.all([
        API.request("/suppliers"),
        API.request("/lookups/products"),
      ]);
      if (!suppliers.length || !products.length)
        throw new Error("أضف الموردين والأصناف أولًا");
      const dialog = UI.modal(
        "تسجيل توريد",
        `<form id="purchaseForm"><div class="form-grid"><label>المورد<select name="supplier_id">${suppliers.map((s) => `<option value="${s.id}">${UI.escape(s.name)}</option>`).join("")}</select></label><label>الدفع<select name="payment_method"><option value="cash">نقدًا</option><option value="knet">كي نت</option></select></label><label>المبلغ المدفوع<input name="paid_amount" type="number" min="0" step="0.001" value="0" required></label><label>ملاحظات<input name="notes"></label></div><div id="purchaseLines"></div><button type="button" id="addPurchaseLine">+ إضافة صنف</button><div id="purchaseError" class="error"></div><footer><button type="button" data-close>إلغاء</button><button class="primary">حفظ التوريد</button></footer></form>`,
      );
      const add = () => {
        const row = document.createElement("div");
        row.className = "purchase-line inline";
        row.style.marginTop = "12px";
        row.innerHTML = `<select name="product_id" style="width:48%">${products.map((p) => `<option value="${p.id}">${UI.escape(p.name_ar)}</option>`).join("")}</select><input name="qty" type="number" min="0.001" step="0.001" value="1" required aria-label="الكمية" style="width:20%"><input name="unit_cost" type="number" min="0" step="0.001" required value="${products[0].cost_price}" aria-label="تكلفة الوحدة" style="width:20%"><button type="button" aria-label="إزالة">×</button>`;
        row.querySelector("select").onchange = (e) =>
          (row.querySelector("[name=unit_cost]").value = products.find(
            (p) => p.id === e.target.value,
          ).cost_price);
        row.querySelector("button").onclick = () => row.remove();
        UI.$("purchaseLines").append(row);
      };
      add();
      UI.$("addPurchaseLine").onclick = add;
      UI.$("purchaseForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = e.target.querySelector(".primary");
        b.disabled = true;
        try {
          const body = Object.fromEntries(new FormData(e.target));
          body.items = [...UI.$("purchaseLines").children].map((r) => ({
            product_id: r.querySelector("select").value,
            qty: Number(r.querySelector("[name=qty]").value),
            unit_cost: Number(r.querySelector("[name=unit_cost]").value),
          }));
          await API.request("/purchases", "POST", body);
          dialog.close();
          await this.load("purchases");
          await POS.snapshot();
          UI.toast("تم تسجيل التوريد وقيده المحاسبي");
        } catch (err) {
          UI.$("purchaseError").textContent = err.message;
        } finally {
          b.disabled = false;
        }
      };
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  async supplierPayment() {
    const suppliers = await API.request("/suppliers");
    this.form(
      "سداد مورد",
      [
        this.field(
          "supplier_id",
          "المورد",
          "select",
          suppliers.map((s) => [
            s.id,
            s.name + " — " + UI.money(s.balance_due),
          ]),
          true,
        ),
        this.field("amount", "المبلغ", "number", [], true),
        this.field(
          "payment_method",
          "طريقة الدفع",
          "select",
          [
            ["cash", "نقدًا"],
            ["knet", "كي نت"],
          ],
          true,
          "cash",
        ),
        this.field("notes", "ملاحظات"),
      ],
      {},
      async (f) => {
        await API.request("/suppliers/payments", "POST", Object.fromEntries(f));
        await this.load("suppliers");
      },
    );
  },
  async shiftReport(id) {
    try {
      const r = await API.request("/reports/shifts/" + id);
      UI.modal(
        "تقرير الوردية " + r.report_type,
        `<p>الكاشير: ${UI.escape(r.cashier_name)} · وردية ${r.shift_no}</p><table><tbody>${[
          ["رصيد الافتتاح", r.opening_cash],
          ["النقد المحصل", r.total_cash_sales],
          ["تحصيل كي نت", r.total_knet_sales],
          ["رد النقد", r.cash_refunds],
          ["المصروفات النقدية", r.cash_outflows],
          ["النقد المتوقع", r.expected_cash],
          ["النقد الفعلي", r.actual_cash],
          ["الفارق", r.discrepancy],
          ["صافي المبيعات", r.total_sales],
          ["المرتجعات", r.total_refunds],
        ]
          .map(
            ([k, v]) =>
              `<tr><td>${k}</td><td class="money">${v === null ? "—" : UI.money(v)}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table><p>عدد الفواتير: ${r.invoice_count}</p><footer><button data-close>إغلاق</button></footer>`,
      );
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  importPage() {
    UI.$("adminContent").innerHTML =
      '<form id="importForm" style="max-width:560px"><p>الملفات المدعومة CSV و XLSX. تستخدم الترويسة أسماء الحقول في مخطط البيانات. تُحدَّث السجلات الموجودة حسب SKU أو رقم العضوية.</p><label>نوع البيانات<select name="type"><option value="products">أصناف</option><option value="members">أعضاء</option></select></label><label style="margin:16px 0">الملف<input name="file" type="file" accept=".csv,.xlsx" required></label><button class="primary">استيراد</button><button type="button" id="importTemplate">تحميل قالب CSV</button><div id="importResult"></div></form>';
    UI.$("importTemplate").onclick = () => {
      const type = UI.$("importForm").querySelector("select").value;
      const headers =
        type === "products"
          ? "sku,name_ar,name_en,category_id,sale_price,cost_price,min_stock_alert,is_discountable,barcodes,initial_qty"
          : "membership_no,civil_id,name,category_id,phone,email,workplace,is_eligible_for_discount,status";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob(["\uFEFF" + headers + "\r\n"], {
          type: "text/csv;charset=utf-8",
        }),
      );
      a.download = "KTS-" + type + "-template.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    UI.$("importForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector(".primary");
      b.disabled = true;
      const originalLabel = b.textContent;
      b.textContent = "جارٍ الاستيراد… يرجى انتظار النتيجة";
      try {
        const form = new FormData(e.target);
        const result = await API.request(
          "/import/" + form.get("type"),
          "POST",
          form,
          { signal: AbortSignal.timeout(600000) },
        );
        UI.$("importResult").innerHTML =
          `<p>تم استيراد ${result.imported} من ${result.total}</p>${this.table(
            result.errors,
            [
              ["row", "السطر"],
              ["error", "المشكلة"],
            ],
          )}`;
        await POS.snapshot();
      } catch (err) {
        UI.toast(err.message, true);
      } finally {
        b.disabled = false;
        b.textContent = originalLabel;
      }
    };
  },
  async settings() {
    const settings = await API.request("/settings");
    if (this.section !== "settings") return;
    UI.$("adminContent").innerHTML =
      '<div style="max-width:600px"><p>تظهر البيانات التالية على الفاتورة الحرارية. تُحفظ محليًا وتعمل دون اتصال بالإنترنت.</p><form id="settingsForm"><div class="form-grid">' +
      [
        ["branch_name", "اسم الفرع"],
        ["branch_phone", "هاتف الفرع"],
        ["branch_address", "العنوان"],
        ["logo_url", "مسار / رابط الشعار"],
        ["return_policy", "سياسة الاسترجاع المعتمدة"],
        ["return_window_days", "مهلة الاسترجاع بالأيام"],
      ]
        .map(
          ([k, v]) =>
            `<label ${k === "return_policy" ? 'class="wide"' : ""}>${v}${k === "return_policy" ? `<textarea name="${k}">${UI.escape(settings[k] || "")}</textarea>` : `<input name="${k}" value="${UI.escape(settings[k] || "")}">`}</label>`,
        )
        .join("") +
      '</div><footer><button class="primary">حفظ الإعدادات</button></footer></form></div>';
    UI.$("settingsForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.request(
          "/settings",
          "PUT",
          Object.fromEntries(new FormData(e.target)),
        );
        await POS.snapshot();
        UI.toast("تم حفظ إعدادات الفاتورة");
      } catch (err) {
        UI.toast(err.message, true);
      }
    };
  },
};
