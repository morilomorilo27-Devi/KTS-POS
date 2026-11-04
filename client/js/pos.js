window.POS = {
  cart: [],
  member: null,
  rule: null,
  products: [],
  categories: [],
  rules: [],
  payment: "cash",
  totals: { subtotal: 0, discount_total: 0, net_total: 0, items: [] },
  busy: false,
  txId: null,
  searchIndex: 0,
  searchMatches: [],
  calcVersion: 0,
  async init(offline = false) {
    if (!this.bound) {
      this.bind();
      this.bound = true;
    }
    const cached = await Offline.get("snapshot");
    if (cached) {
      this.useSnapshot(cached);
      this.renderCategories();
      this.renderProducts();
    }
    if (offline) {
      if (!cached) throw new Error("لا يوجد كتالوج محلي، يلزم الاتصال أول مرة");
    } else await this.snapshot();
    const saved = await Offline.get("cart:" + Auth.user.id);
    if (saved) {
      this.cart = saved.cart || [];
      this.member = saved.member || null;
      this.rule = saved.rule || null;
      this.txId = saved.txId || null;
    } else {
      this.cart = [];
      this.member = null;
      this.rule = null;
      this.txId = null;
    }
    this.renderCategories();
    this.renderProducts();
    this.renderMember();
    await this.calculate();
    clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this.sync(), 20000);
    this.sync();
  },
  useSnapshot(s) {
    this.products = s.products;
    this.categories = s.categories;
    this.members = s.members;
    this.rules = s.rules;
    this.specialPrices = s.membership_product_prices || [];
    this.memberProfiles = s.member_profiles || [];
    this.memberWallets = s.member_wallets || [];
    this.memberVouchers = s.member_vouchers || [];
  },
  async snapshot() {
    if(!Auth.can("pos_sale"))return;
    const s = await API.request("/sync/snapshot");
    for (const t of await Offline.pending())
      for (const l of t.items) {
        const p = s.products.find((p) => p.id === l.product_id);
        if (p) p.qty_on_hand = Math.max(0, p.qty_on_hand - l.qty);
      }
    await Offline.set("snapshot", s);
    this.useSnapshot(s);
    this.settings = await API.request("/settings");
    await Offline.set("settings", this.settings);
    if (this.settings.logo_url) UI.$("brandLogo").src = this.settings.logo_url;
    this.renderCategories();
    this.renderProducts();
    return s;
  },
  async save() {
    await Offline.set("cart:" + Auth.user.id, {
      cart: this.cart,
      member: this.member,
      rule: this.rule,
      txId: this.txId,
    });
  },
  bind() {
    const search = UI.$("posSearchInput");
    search.oninput = () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.search(search.value), 90);
    };
    search.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.searchIndex = Math.max(
          0,
          Math.min(
            this.searchMatches.length - 1,
            this.searchIndex + (e.key === "ArrowDown" ? 1 : -1),
          ),
        );
        this.renderSearch();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const value = search.value.trim();
        if (!value) return;
        clearTimeout(this.searchTimer);
        const exact = this.products.find(
          (p) =>
            p.sku === value || p.barcodes.includes(value),
        );
        if (!exact && this.query !== value) this.search(value);
        const p = exact || this.searchMatches[this.searchIndex];
        if (p) {
          this.add(p);
          search.value = "";
          if (this.query) this.search("");
          else UI.$("searchResults").hidden = true;
        } else {
          window.POSDesign?.reportError(
            "لم نجد صنفًا مطابقًا. أعد المسح أو جرّب الاسم أو رمز الصنف.",
            "الصنف غير موجود",
          );
        }
      }
    };
    search.onblur = () =>
      setTimeout(() => (UI.$("searchResults").hidden = true), 180);
    UI.$("catalogSort").onchange = () => this.renderProducts();
    UI.$("catalogPrev").onclick = () =>
      this.renderProducts(Math.max(0, this.productPage - 1));
    UI.$("catalogNext").onclick = () =>
      this.renderProducts(this.productPage + 1);
    UI.$("catalogToggle").onclick = () => this.toggleCatalog();
    UI.$("memberForm").onsubmit = (e) => {
      e.preventDefault();
      this.verifyMember();
    };
    UI.$("clearMember").onclick = () => {
      this.member = null;
      this.rule = null;
      this.voucherCode = null;
      this.walletAmount = 0;
      this.txId = null;
      this.renderMember();
      this.calculate();
    };
    UI.$("active-discount-display-card").onclick = () => this.discountDialog();
    UI.$("discountForm").onsubmit = (e) => {
      e.preventDefault();
      this.rule = new FormData(e.target).get("rule") || null;
      this.txId = null;
      UI.$("memberDiscountModal").close();
      this.renderMember();
      this.calculate();
    };
    UI.$("holdButton").onclick = () => this.hold();
    UI.$("heldButton").onclick = () => this.heldDialog();
    UI.$("paymentSelector").onclick = (e) => {
      const b = e.target.closest("[data-payment]");
      if (b) {
        this.payment = b.dataset.payment;
        this.txId = null;
        this.renderPayment();
        this.save();
      }
    };
    UI.$("splitCash").oninput = () => {
      const value = Number(UI.$("splitCash").value);
      UI.$("splitKnet").value = Math.max(
        0,
        UI.round(this.totals.net_total - value),
      ).toFixed(3);
      this.renderSplitStatus();
    };
    UI.$("splitKnet").oninput = () => {
      const value = Number(UI.$("splitKnet").value);
      UI.$("splitCash").value = Math.max(
        0,
        UI.round(this.totals.net_total - value),
      ).toFixed(3);
      this.renderSplitStatus();
    };
    UI.$("equalSplit").onclick = () => this.equalSplit();
    UI.$("paidAmount").oninput = () => this.renderChange();
    UI.$("checkoutButton").onclick = () => this.checkout();
    UI.$("helpButton").onclick = () => this.help();
    UI.$("printReceipt").onclick = () => Printing.receipt();
    UI.$("connectionStatus").onclick = () => this.pendingDialog();
    UI.$("verifyInvoiceForm").onsubmit = (e) => {
      e.preventDefault();
      this.verifyReturn(new FormData(e.target).get("invoice_no"));
    };
    document.addEventListener("keydown", (e) => {
      const alternative = e.altKey && !e.ctrlKey && !e.metaKey
        ? { Digit1:"F1",Digit2:"F2",Digit3:"F3",Digit4:"F4",Digit7:"F7",Digit8:"F8",Digit9:"F9",Digit0:"F10" }[e.code]
        : null;
      const key = alternative || e.key;
      const shortcuts = ["F1", "F2", "F3", "F4", "F7", "F8", "F9", "F10"];
      if (!shortcuts.includes(key) || !Auth.user) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.busy || document.querySelector("dialog[open]")) return;
      if (key === "F1") this.help();
      if (Auth.viewName !== "pos" && key !== "F1") return;
      if (key === "F2") {
        search.focus();
        search.select();
      }
      if (key === "F3") this.toggleCatalog();
      if (key === "F4") this.hold();
      if (key === "F7") {
        window.CustomerDisplayBridge?.open();
      }
      if (key === "F8") {
        UI.$("memberForm").hidden = false;
        UI.$("memberSearchInput").focus();
        UI.$("memberSearchInput").select();
      }
      if (key === "F9") this.heldDialog();
      if (key === "F10") this.checkout();
    }, true);
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".product-command"))
        UI.$("searchResults").hidden = true;
    });
  },
  renderCategories() {
    const rail = UI.$("categoryRail");
    rail.innerHTML = "";
    const cats = [
      { id: "", name_ar: "الكل", products_count: this.products.length },
      ...this.categories.filter((c) => c.status === "active"),
    ];
    for (const [i, c] of cats.entries()) {
      const b = document.createElement("button");
      b.className = c.id === (this.category || "") ? "active" : "";
      b.innerHTML =
        UI.icon(["box", "art", "pen", "book", "file", "tech"][i] || "box") +
        `<span>${UI.escape(c.name_ar)}<small>${c.products_count} صنف</small></span>`;
      b.onclick = () => {
        this.category = c.id;
        UI.$("posSearchInput").value = "";
        this.query = "";
        this.renderCategories();
        this.renderProducts();
      };
      rail.append(b);
    }
  },
  renderProducts(page = 0) {
    const grid = UI.$("productGrid");
    let products = this.products.filter(
      (p) =>
        (!this.category || p.category_id === this.category) &&
        (!this.query || this.match(p, this.query)),
    );
    const sort = UI.$("catalogSort").value;
    const collator = this._arCollator || (this._arCollator = new Intl.Collator("ar"));
    products.sort((a, b) =>
      sort === "price"
        ? a.sale_price - b.sale_price
        : sort === "stock"
          ? b.qty_on_hand - a.qty_on_hand
          : collator.compare(a.name_ar, b.name_ar),
    );
    this.productPage = typeof page === "number" ? page : 0;
    UI.$("catalogPrev").hidden = products.length <= 120;
    UI.$("catalogNext").hidden = products.length <= 120;
    UI.$("catalogPrev").disabled = this.productPage === 0;
    UI.$("catalogNext").disabled =
      (this.productPage + 1) * 120 >= products.length;
    UI.$("catalogCount").textContent =
      products.length +
      " صنف" +
      (products.length > 120
        ? " · " +
          (this.productPage + 1) +
          " / " +
          Math.ceil(products.length / 120)
        : "");
    UI.$("catalogTitle").textContent =
      this.categories.find((c) => c.id === this.category)?.name_ar ||
      "جميع الأصناف";
    grid.innerHTML = "";
    if (!products.length) {
      grid.innerHTML = `<div class="empty-state product-empty" style="grid-column:1/-1">${UI.icon("box")}<strong>لا توجد أصناف مطابقة</strong><p>غيّر عبارة البحث أو اختر فئة أخرى من الشريط أعلاه</p></div>`;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const p of products.slice(
      this.productPage * 120,
      (this.productPage + 1) * 120,
    )) {
      const b = document.createElement("button");
      b.className = "product-card";
      b.dataset.productId = p.id;
      b.setAttribute("aria-label", "إضافة " + p.name_ar);
      b.innerHTML = `<div class="product-image">${p.image_url ? `<img src="${UI.escape(this.imageUrl(p.image_url))}" alt="" loading="lazy">` : UI.icon("box")}</div><div class="product-info"><div class="product-name">${UI.escape(p.name_ar)}</div><div class="product-meta"><span class="product-sku">${UI.escape(p.sku)}</span><span class="stock ${p.qty_on_hand <= 0 ? "out" : p.qty_on_hand <= p.min_stock_alert ? "low" : ""}">${p.qty_on_hand <= 0 ? "نفد المخزون" : p.qty_on_hand <= p.min_stock_alert ? "متبقٍ " + p.qty_on_hand : "متوفر " + p.qty_on_hand}</span></div><div class="product-price"><strong class="money">${UI.money(p.sale_price)}</strong><span class="add-action" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span></div></div>`;
      const img = b.querySelector("img");
      if (img)
        img.onerror = () => {
          img.parentElement.innerHTML = UI.icon("box");
        };
      b.onclick = () => {
        if (this.add(p)) {
          b.classList.add("added");
          setTimeout(() => b.classList.remove("added"), 170);
        }
      };
      fragment.append(b);
    }
    grid.append(fragment);
  },
  imageUrl(url) {
    if (/^https?:\/\//.test(url) || url.startsWith("/images/")) return url;
    return url.startsWith("images/") ? "/" + url : "";
  },
  match(p, q) {
    q = q.toLocaleLowerCase();
    return (
      p.name_ar.toLocaleLowerCase().includes(q) ||
      (p.name_en || "").toLocaleLowerCase().includes(q) ||
      p.sku.toLocaleLowerCase().includes(q) ||
      p.barcodes.some((b) => b.includes(q))
    );
  },
  search(q) {
    this.query = q.trim();
    this.searchIndex = 0;
    this.searchMatches = this.query
      ? this.products
          .filter((p) => this.match(p, this.query))
          .sort(
            (a, b) =>
              Number(b.barcodes.includes(this.query) || b.sku === this.query) -
              Number(a.barcodes.includes(this.query) || a.sku === this.query),
          )
          .slice(0, 20)
      : [];
    this.renderSearch();
    this.renderProducts();
  },
  renderSearch() {
    const container = UI.$("searchResults");
    container.hidden = !this.query || !this.searchMatches.length;
    container.innerHTML = "";
    for (const [i, p] of this.searchMatches.entries()) {
      const b = document.createElement("button");
      b.className =
        "search-result" + (i === this.searchIndex ? " selected" : "");
      b.innerHTML = `<span><strong>${UI.escape(p.name_ar)}</strong><small><bdi>${UI.escape(p.sku)}</bdi> · ${p.qty_on_hand > 0 ? "متوفر " + p.qty_on_hand : "نفد المخزون"}</small></span><b class="money">${UI.money(p.sale_price)}</b>`;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => {
        this.add(p);
        UI.$("posSearchInput").value = "";
        container.hidden = true;
        UI.$("posSearchInput").focus();
      };
      container.append(b);
    }
  },
  add(p) {
    if (this.busy) return false;
    const line = this.cart.find((l) => l.product_id === p.id);
    if ((line?.qty || 0) + 1 > p.qty_on_hand) {
      UI.toast("المخزون غير كافٍ", true);
      return false;
    }
    if (line) line.qty++;
    else this.cart.push({ product_id: p.id, qty: 1 });
    this.txId = null;
    this.calculate();
    this.beep();
    return true;
  },
  async calculate() {
    const version = ++this.calcVersion;
    if (!this.cart.length) {
      this.totals = { subtotal: 0, discount_total: 0, net_total: 0, items: [] };
      this.renderCart();
      this.renderTotals();
      await this.save();
      return;
    }
    try {
      const result = API.online
        ? await API.request("/discounts/calculate-cart", "POST", {
            items: this.cart,
            member_id: this.member?.id,
            selected_discount_rule_id: this.rule,
            voucher_code: this.voucherCode || null,
            wallet_amount: this.walletAmount || 0,
          })
        : this.localCalculate();
      if (version !== this.calcVersion) return;
      this.totals = result;
      this.renderCart();
      this.renderTotals();
      await this.save();
    } catch (e) {
      if (version !== this.calcVersion) return;
      if (e.offline) {
        this.totals = this.localCalculate();
        this.renderCart();
        this.renderTotals();
        await this.save();
      } else {
        UI.toast(e.message, true);
        UI.$("checkoutButton").disabled = true;
      }
    }
  },
  availableRules() {
    const m = this.member;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuwait",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return m && m.status === "active" && m.is_eligible_for_discount
      ? this.rules
          .filter(
            (r) =>
              r.status === "active" &&
              (!r.start_date || r.start_date <= today) &&
              (!r.end_date || r.end_date >= today) &&
              (r.scope === "all" ||
                r.scope === "product" ||
                r.scope === "category" ||
                (r.scope === "member" && r.target_member_id === m.id) ||
                (r.scope === "membership_category" &&
                  r.target_membership_category_id === m.category_id)),
          )
          .sort((a, b) => a.priority - b.priority)
      : [];
  },
  localCalculate() {
    const rule = this.availableRules().find((r) => r.id === this.rule);
    const items = this.cart.map((l) => {
      const p = this.products.find((p) => p.id === l.product_id);
      if (!p) throw new Error("الصنف غير موجود في الكتالوج المحلي");
      const subtotal = UI.round(p.sale_price * l.qty);
      const special = this.member
        ? this.specialPrices.find(
            (price) =>
              price.membership_category_id === this.member.category_id &&
              price.product_id === p.id,
          )
        : null;
      const specialDiscount = special
        ? UI.round(Math.max(0, p.sale_price - special.special_price) * l.qty)
        : 0;
      return {
        ...l,
        unit_price: p.sale_price,
        subtotal,
        discount_amount: specialDiscount,
        line_total: UI.round(subtotal - specialDiscount),
        applied_rule_id: null,
      };
    });
    const subtotal = UI.round(items.reduce((s, l) => s + l.subtotal, 0));
    if (rule && subtotal >= rule.min_spend) {
      let remaining = rule.max_discount ?? Infinity;
      for (const l of items) {
        const p = this.products.find((p) => p.id === l.product_id);
        if (
          !p.is_discountable ||
          (rule.scope === "product" && p.id !== rule.target_product_id) ||
          (rule.scope === "category" &&
            p.category_id !== rule.target_category_id)
        )
          continue;
        const amount = UI.round(
          rule.type === "percentage"
            ? (l.line_total * rule.value) / 100
            : rule.value * l.qty,
        );
        l.discount_amount = UI.round(
          Math.max(
            0,
            Math.min(
              amount,
              remaining,
              l.line_total - UI.round((p.min_price || 0) * l.qty),
            ),
          ),
        );
        const ruleDiscount = l.discount_amount;
        remaining = UI.round(remaining - ruleDiscount);
        l.discount_amount = UI.round(
          specialDiscount + ruleDiscount,
        );
        l.line_total = UI.round(l.subtotal - l.discount_amount);
        if (ruleDiscount) l.applied_rule_id = rule.id;
      }
    }
    const discount_total = UI.round(
      items.reduce((s, l) => s + l.discount_amount, 0),
    );
    let voucherDiscount = 0;
    const voucher = this.voucherCode
      ? this.memberVouchers.find(
          (entry) =>
            entry.code === this.voucherCode &&
            (!entry.member_id || entry.member_id === this.member?.id),
        )
      : null;
    if (this.voucherCode && !voucher)
      throw new Error("القسيمة غير صالحة لهذه العضوية");
    if (voucher)
      voucherDiscount = UI.round(
        Math.min(voucher.remaining_value, subtotal - discount_total),
      );
    const wallet = this.memberWallets.find(
      (entry) => entry.member_id === this.member?.id,
    );
    const walletDiscount = UI.round(
      Math.min(
        Number(this.walletAmount || 0),
        wallet?.balance || 0,
        subtotal - discount_total - voucherDiscount,
      ),
    );
    let benefitRemaining = UI.round(voucherDiscount + walletDiscount);
    for (const line of items) {
      if (benefitRemaining <= 0) break;
      const amount = UI.round(Math.min(line.line_total, benefitRemaining));
      line.discount_amount = UI.round(line.discount_amount + amount);
      line.line_total = UI.round(line.line_total - amount);
      benefitRemaining = UI.round(benefitRemaining - amount);
    }
    const finalDiscount = UI.round(
      items.reduce((sum, line) => sum + line.discount_amount, 0),
    );
    return {
      subtotal,
      discount_total: finalDiscount,
      net_total: UI.round(subtotal - finalDiscount),
      voucher_id: voucher?.id || null,
      voucher_discount: voucherDiscount,
      wallet_discount: walletDiscount,
      items,
    };
  },
  renderCart() {
    const container = UI.$("cartItems");
    const qty = this.cart.reduce((s, l) => s + l.qty, 0);
    UI.$("cartCount").textContent = qty + " قطع";
    container.innerHTML = "";
    if (!this.cart.length)
      container.innerHTML =
        UI.icon("basket") +
        "<strong>السلة فارغة</strong><p>امسح الباركود أو اختر صنفًا من الكتالوج</p>";
    container.classList.toggle("empty-state", !this.cart.length);
    for (const l of this.cart) {
      const p = this.products.find((p) => p.id === l.product_id);
      if (!p) continue;
      const total = this.totals.items.find((i) => i.product_id === p.id);
      const row = document.createElement("div");
      row.className = "cart-row";
      row.innerHTML = `<div class="cart-row-header"><div><strong>${UI.escape(p.name_ar)}</strong><small class="cart-sku">${UI.escape(p.sku)}</small></div><button data-remove aria-label="إزالة ${UI.escape(p.name_ar)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5" /></svg></button></div><div class="cart-row-controls"><div class="qty-controls"><button data-delta="-1" aria-label="تقليل الكمية">−</button><span>${l.qty}</span><button data-delta="1" aria-label="زيادة الكمية">+</button></div><div class="cart-line-money"><small class="money">${UI.money(p.sale_price)} × ${l.qty}</small><b class="money">${UI.money(total?.line_total ?? p.sale_price * l.qty)}</b></div></div>`;
      row.onclick = (e) => {
        if (this.busy) return;
        const b = e.target.closest("button");
        if (!b) return;
        if (b.hasAttribute("data-remove"))
          this.cart = this.cart.filter((i) => i !== l);
        else {
          const qty = l.qty + Number(b.dataset.delta);
          if (qty > p.qty_on_hand) {
            UI.toast("المخزون غير كافٍ", true);
            return;
          }
          l.qty = qty;
          if (qty <= 0) this.cart = this.cart.filter((i) => i !== l);
        }
        this.txId = null;
        this.calculate();
      };
      container.append(row);
    }
    this.renderCartTable();
  },
  renderCartTable() {
    UI.$("cartTableWorkspace").innerHTML =
      `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>SKU</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الصافي</th></tr></thead><tbody>${this.totals.items
        .map((l) => {
          const p = this.products.find((p) => p.id === l.product_id);
          return `<tr><td>${UI.escape(p?.name_ar)}</td><td class="ltr">${UI.escape(p?.sku)}</td><td>${l.qty}</td><td class="money">${UI.money(l.unit_price)}</td><td class="money">${UI.money(l.discount_amount)}</td><td class="money">${UI.money(l.line_total)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`;
  },
  renderTotals() {
    for (const [id, value] of [
      ["subtotal", this.totals.subtotal],
      ["discountTotal", this.totals.discount_total],
      ["netTotal", this.totals.net_total],
    ])
      UI.$(id).textContent =
        (id === "discountTotal" ? "−" : "") + UI.money(value);
    UI.$("checkoutButton").disabled =
      this.busy || !this.cart.length || this.totals.net_total <= 0;
    this.renderPayment();
  },
  renderPayment() {
    for (const b of UI.$("paymentSelector").children)
      b.classList.toggle("selected", b.dataset.payment === this.payment);
    UI.$("cashPaymentBox").hidden = this.payment !== "cash";
    UI.$("knetPaymentBox").hidden = this.payment !== "knet";
    UI.$("split-payment-inline-box").hidden = this.payment !== "split";
    if (this.payment === "split") {
      if (
        this.lastSplitTotal !== this.totals.net_total ||
        UI.$("splitCash").value === ""
      )
        this.equalSplit();
      this.lastSplitTotal = this.totals.net_total;
      this.renderSplitStatus();
    } else this.renderChange();
  },
  equalSplit() {
    UI.$("splitCash").value = (
      Math.floor((this.totals.net_total * 1000) / 2) / 1000
    ).toFixed(3);
    UI.$("splitKnet").value = UI.round(
      this.totals.net_total - Number(UI.$("splitCash").value),
    ).toFixed(3);
    this.renderSplitStatus();
  },
  renderSplitStatus() {
    const sum = UI.round(
      Number(UI.$("splitCash").value) + Number(UI.$("splitKnet").value),
    );
    const remaining = UI.round(this.totals.net_total - sum);
    UI.$("splitStatus").textContent =
      sum === this.totals.net_total
        ? "المتبقي 0.000 د.ك · موزع بالكامل"
        : (remaining < 0 ? "المبلغ الزائد " : "المتبقي ") + UI.money(Math.abs(remaining));
    UI.$("splitStatus").className =
      sum === this.totals.net_total ? "" : "error";
  },
  renderChange() {
    const paid =
      UI.$("paidAmount").value === ""
        ? this.totals.net_total
        : Number(UI.$("paidAmount").value);
    UI.$("paidAmount").placeholder = this.totals.net_total.toFixed(3);
    UI.$("changeDue").textContent =
      "الباقي: " +
      UI.money(Math.max(0, UI.round(paid - this.totals.net_total)));
  },
  toggleCatalog() {
    this.cartTable = !this.cartTable;
    UI.$("productGrid").hidden = this.cartTable;
    UI.$("cartTableWorkspace").hidden = !this.cartTable;
    UI.$("catalogToggle").innerHTML =
      (this.cartTable ? "عرض الكتالوج" : "عرض السلة") + " <kbd>F3</kbd>";
  },
  async verifyMember() {
    if(!Auth.can("pos_member_lookup"))return UI.toast("لا تملك صلاحية البحث عن الأعضاء",true);
    const q = UI.$("memberSearchInput").value.trim();
    if (!q) return;
    try {
      let results;
      if (API.online)
        results = await API.request(
          "/members/search-pos?q=" + encodeURIComponent(q),
        );
      else
        results = this.members.filter((m) =>
          m.membership_no === q || m.name.includes(q),
        );
      if (!results.length) {
        UI.toast("لم يتم العثور على العضو", true);
        return;
      }
      if (results.length > 1) {
        const dialog = UI.modal(
          "اختيار العضو",
          results
            .map(
              (m) =>
                `<button class="discount-option" data-member="${UI.escape(m.id)}">${UI.escape(m.name)} — ${UI.escape(m.membership_no)}</button>`,
            )
            .join(""),
        );
        for (const b of dialog.querySelectorAll("[data-member]"))
          b.onclick = () => {
            dialog.close();
            this.setMember(results.find((m) => m.id === b.dataset.member));
          };
      } else this.setMember(results[0]);
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  setMember(member) {
    this.member = member;
    this.rule = null;
    this.voucherCode = null;
    this.walletAmount = 0;
    this.txId = null;
    this.renderMember();
    this.calculate();
    if (member.status === "active" && member.is_eligible_for_discount)
      this.discountDialog();
    else UI.toast("العضوية غير مؤهلة للخصم", true);
  },
  renderMember() {
    const card = UI.$("member-profile-card");
    card.hidden = !this.member;
    UI.$("memberForm").hidden = Boolean(this.member);
    UI.$("clearMember").hidden = !this.member;
    UI.$("active-discount-display-card").hidden = !this.member;
    if (this.member) {
      card.innerHTML = `<div class="member-details"><span class="member-avatar">${UI.escape(this.member.name.slice(0, 1))}</span><div class="member-identity"><span class="member-approved">${this.member.status === "active" ? "عضوية معتمدة" : "عضوية غير فعالة"}</span><strong>${UI.escape(this.member.name)}</strong><small><bdi>${UI.escape(this.member.membership_no)}</bdi> · ${UI.escape(this.member.category_name || "بدون فئة")}</small></div></div>`;
      const rule = this.rules.find((r) => r.id === this.rule);
      UI.$("active-discount-display-card").innerHTML =
        `<span>الخصم المطبق · ${UI.escape(rule?.name_ar || "بدون خصم")}</span><b>${rule ? (rule.type === "percentage" ? rule.value + "%" : UI.money(rule.value)) : "0%"} ‹</b>`;
    }
  },
  discountDialog() {
    if(!Auth.can("pos_discount"))return;
    if (!this.member) return;
    UI.$("discountMemberName").textContent =
      this.member.name + " · " + this.member.membership_no;
    UI.$("discountOptions").innerHTML = [
      {
        id: "",
        name_ar: "بدون خصم (السعر الكامل)",
        value: 0,
        type: "percentage",
      },
      ...this.availableRules(),
    ]
      .map(
        (r) =>
          `<label class="discount-option"><span><input type="radio" name="rule" value="${UI.escape(r.id)}" ${r.id === (this.rule || "") ? "checked" : ""}>${UI.escape(r.name_ar)}</span><b>${r.type === "percentage" ? r.value + "%" : UI.money(r.value)}</b></label>`,
      )
      .join("");
    UI.$("memberDiscountModal").showModal();
  },
  async checkout() {
    if(!Auth.can("pos_checkout"))return UI.toast("لا تملك صلاحية إتمام البيع",true);
    if(!Auth.can("pos_payment_"+this.payment))return UI.toast("طريقة الدفع غير مسموحة لحسابك",true);
    if(this.payment==="split"&&(!Auth.can("pos_payment_cash")||!Auth.can("pos_payment_knet")))return UI.toast("تقسيم الدفع يتطلب إتاحة النقد وكي نت",true);
    if (this.busy || !this.cart.length) return;
    if (!Auth.shift) {
      Auth.shiftDialog();
      return;
    }
    this.busy = true;
    document.querySelector(".catalog").classList.add("busy");
    document.querySelector(".transaction-rail").classList.add("busy");
    UI.$("checkoutButton").disabled = true;
    try {
      await this.calculate();
      this.txId = this.txId || crypto.randomUUID();
      await this.save();
      const total = this.totals.net_total;
      let payments;
      if (this.payment === "split") {
        payments = [
          {
            payment_method: "cash",
            amount: UI.round(Number(UI.$("splitCash").value)),
          },
          {
            payment_method: "knet",
            amount: UI.round(Number(UI.$("splitKnet").value)),
            reference_no: UI.$("knetReference").value,
          },
        ].filter((p) => p.amount > 0);
        if (UI.round(payments.reduce((s, p) => s + p.amount, 0)) !== total)
          throw new Error("تقسيم الدفع غير مطابق");
      } else
        payments = [
          {
            payment_method: this.payment,
            amount:
              this.payment === "cash" && UI.$("paidAmount").value !== ""
                ? UI.round(Number(UI.$("paidAmount").value))
                : total,
            reference_no:
              this.payment === "knet" ? UI.$("knetReference").value : null,
          },
        ];
      const paid_amount = UI.round(payments.reduce((s, p) => s + p.amount, 0));
      if (paid_amount < total || total <= 0)
        throw new Error("المبلغ المدفوع غير كافٍ");
      const payload = {
        client_transaction_id: this.txId,
        shift_id: Auth.shift.id,
        member_id: this.member?.id || null,
        selected_discount_rule_id: this.rule,
        voucher_code: this.voucherCode || null,
        wallet_amount: this.walletAmount || 0,
        items: this.cart.map((l) => ({ ...l })),
        ...this.totals,
        paid_amount,
        payments,
        notes: "",
        knet_client_reference: this.knetClientReference || null,
      };
      payload.items = this.cart.map((l) => ({ ...l }));
      let result;
      try {
        result = await API.request("/pos/checkout", "POST", payload);
      } catch (e) {
        if (!e.offline) throw e;
        for (const l of this.cart) {
          const p = this.products.find((p) => p.id === l.product_id);
          if (!p || l.qty > p.qty_on_hand)
            throw new Error("المخزون المحلي غير كافٍ");
        }
        await Offline.queue(payload, Auth.user.id);
        for (const l of this.cart)
          this.products.find((p) => p.id === l.product_id).qty_on_hand -= l.qty;
        result = {
          invoice: {
            ...payload,
            id: this.txId,
            invoice_no: "مؤجل — " + this.txId.slice(0, 8),
            cashier_name: Auth.user.full_name,
            shift_no: Auth.shift.shift_no,
            created_at: new Date().toLocaleString("ar-KW"),
            change_due: UI.round(paid_amount - total),
            items: this.totals.items.map((l) => ({
              ...l,
              name_ar: this.products.find((p) => p.id === l.product_id)
                ?.name_ar,
            })),
            offline: true,
          },
        };
        UI.toast("حُفظ البيع محليًا وسيُزامن عند عودة الخادم");
      }
      await this.clear();
      await this.receipt(result.invoice);
      this.beep(true);
      if (API.online) {
        await Auth.refreshShift();
        await this.snapshot();
      }
    } catch (e) {
      UI.toast(e.message, true);
    } finally {
      this.busy = false;
      document.querySelector(".catalog").classList.remove("busy");
      document.querySelector(".transaction-rail").classList.remove("busy");
      this.renderTotals();
    }
  },
  async clear() {
    this.cart = [];
    this.member = null;
    this.rule = null;
    this.voucherCode = null;
    this.walletAmount = 0;
    this.txId = null;
    this.payment = "cash";
    this.knetClientReference = null;
    UI.$("paidAmount").value = "";
    UI.$("knetReference").value = "";
    this.renderMember();
    await this.calculate();
  },
  async hold() {
    if(!Auth.can("pos_hold_cart"))return UI.toast("لا تملك صلاحية تعليق السلات",true);
    if (!this.cart.length || this.busy) return;
    try {
      if (!Auth.shift) throw new Error("افتح وردية أولًا");
      const payload = {
        shift_id: Auth.shift.id,
        items: this.cart.map((l) => ({ ...l })),
        member: this.member,
        selected_discount_rule_id: this.rule,
      };
      try {
        await API.request("/pos/hold-cart", "POST", payload);
      } catch (error) {
        if (!error.offline) throw error;
        const key = "held:" + Auth.user.id;
        const local = (await Offline.get(key)) || [];
        const id = "local-" + crypto.randomUUID();
        local.push({
          id,
          cart_ref: "CART-" + id.slice(6, 14).toUpperCase(),
          shift_id: Auth.shift.id,
          payload,
        });
        await Offline.set(key, local);
      }
      await this.clear();
      UI.toast("تم تعليق السلة");
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  async heldDialog() {
    if(!Auth.can("pos_hold_cart"))return UI.toast("لا تملك صلاحية السلات المعلقة",true);
    try {
      if (this.cart.length)
        throw new Error("علّق السلة الحالية أو أتم البيع قبل استرجاع سلة أخرى");
      const key = "held:" + Auth.user.id;
      const local = ((await Offline.get(key)) || []).filter(
        (c) => c.shift_id === Auth.shift?.id,
      );
      let remote = [];
      try {
        remote = await API.request("/pos/held-carts");
      } catch (error) {
        if (!error.offline) throw error;
      }
      const carts = [...local, ...remote];
      const dialog = UI.modal(
        "السلات المعلقة",
        carts.length
          ? carts
              .map(
                (c) =>
                  `<button class="discount-option" data-cart="${UI.escape(c.id)}"><span>${UI.escape(c.cart_ref)} · ${UI.escape(c.payload.member?.name || "عميل نقدي")}</span><b>${c.payload.items.length} أصناف</b></button>`,
              )
              .join("")
          : "<p>لا توجد سلات معلقة لهذه الوردية</p>",
      );
      for (const b of dialog.querySelectorAll("[data-cart]"))
        b.onclick = async () => {
          b.disabled = true;
          try {
            const localCart = local.find((c) => c.id === b.dataset.cart);
            const c =
              localCart ||
              (await API.request(
                "/pos/held-carts/" + b.dataset.cart,
                "DELETE",
              ));
            this.cart = c.payload.items;
            this.member = c.payload.member;
            this.rule = c.payload.selected_discount_rule_id;
            this.txId = null;
            dialog.close();
            this.renderMember();
            await this.calculate();
            if (localCart)
              await Offline.set(
                key,
                ((await Offline.get(key)) || []).filter(
                  (c) => c.id !== localCart.id,
                ),
              );
          } catch (e) {
            UI.toast(e.message, true);
            b.disabled = false;
          }
        };
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  async sync(show = false) {
    if (this.syncBusy || !Auth.user) return;
    this.syncBusy = true;
    try {
      const identity=await API.request("/auth/me");
      if(identity.user.access_revision!==Auth.user.access_revision && Auth.refreshAccess)await Auth.refreshAccess();
      if(!Auth.can("pos_sale"))return;
      const pending = (await Offline.pending()).filter(
        (t) => t.offline_user_id === Auth.user.id,
      );
      for (const batch of Array.from(
        { length: Math.ceil(pending.length / 100) },
        (_, i) => pending.slice(i * 100, i * 100 + 100),
      )) {
        const response = await API.request("/sync/upload", "POST", {
          transactions: batch,
        });
        for (const r of response.results) {
          if (r.success) {
            await Offline.remove(r.client_transaction_id);
            await Offline.set("invoice:" + r.client_transaction_id, r.invoice);
          } else {
            const failed = batch.find(
              (t) => t.client_transaction_id === r.client_transaction_id,
            );
            await Offline.updatePending({ ...failed, sync_error: r.error });
            UI.toast(
              "تحتاج الفاتورة المؤجلة " +
                r.client_transaction_id.slice(0, 8) +
                " إلى معالجة: " +
                r.error,
              true,
            );
          }
        }
      }
      if (pending.length) {
        await Auth.refreshShift();
        await this.snapshot();
        UI.toast("انتهت محاولة مزامنة الفواتير المؤجلة");
      } else if (show) UI.toast("الاتصال بالخادم سليم، لا توجد فواتير مؤجلة");
    } catch (e) {
      if (show) UI.toast(e.message, true);
    } finally {
      this.syncBusy = false;
    }
  },
  barcode(text) {
    const patterns = [
      "212222",
      "222122",
      "222221",
      "121223",
      "121322",
      "131222",
      "122213",
      "122312",
      "132212",
      "221213",
      "221312",
      "231212",
      "112232",
      "122132",
      "122231",
      "113222",
      "123122",
      "123221",
      "223211",
      "221132",
      "221231",
      "213212",
      "223112",
      "312131",
      "311222",
      "321122",
      "321221",
      "312212",
      "322112",
      "322211",
      "212123",
      "212321",
      "232121",
      "111323",
      "131123",
      "131321",
      "112313",
      "132113",
      "132311",
      "211313",
      "231113",
      "231311",
      "112133",
      "112331",
      "132131",
      "113123",
      "113321",
      "133121",
      "313121",
      "211331",
      "231131",
      "213113",
      "213311",
      "213131",
      "311123",
      "311321",
      "331121",
      "312113",
      "312311",
      "332111",
      "314111",
      "221411",
      "431111",
      "111224",
      "111422",
      "121124",
      "121421",
      "141122",
      "141221",
      "112214",
      "112412",
      "122114",
      "122411",
      "142112",
      "142211",
      "241211",
      "221114",
      "413111",
      "241112",
      "134111",
      "111242",
      "121142",
      "121241",
      "114212",
      "124112",
      "124211",
      "411212",
      "421112",
      "421211",
      "212141",
      "214121",
      "412121",
      "111143",
      "111341",
      "131141",
      "114113",
      "114311",
      "411113",
      "411311",
      "113141",
      "114131",
      "311141",
      "411131",
      "211412",
      "211214",
      "211232",
      "2331112",
    ];
    const codes = [
      104,
      ...[...text]
        .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)
        .map((c) => c.charCodeAt(0) - 32),
    ];
    codes.push(codes.reduce((s, c, i) => s + c * (i || 1), 0) % 103, 106);
    let x = 10;
    let rects = "";
    for (const code of codes) {
      let bar = true;
      for (const digit of patterns[code]) {
        const width = Number(digit);
        if (bar)
          rects += `<rect x="${x}" y="0" width="${width}" height="36" fill="black"/>`;
        x += width;
        bar = !bar;
      }
    }
    return `<svg class="barcode" style="stroke:none" viewBox="0 0 ${x + 10} 36" role="img" aria-label="باركود الفاتورة">${rects}</svg>`;
  },
  async receipt(invoice) {
    this.lastInvoice = invoice;
    const settings = this.settings || (await Offline.get("settings")) || {};
    const receiptTime = invoice.offline
      ? invoice.created_at
      : new Date(invoice.created_at.replace(" ", "T") + "Z").toLocaleString(
          "ar-KW",
          { timeZone: "Asia/Kuwait", numberingSystem: "latn" },
        );
    UI.$("receiptPaper").innerHTML =
      `<header>${settings.logo_url ? `<img src="${UI.escape(this.imageUrl(settings.logo_url))}" alt="">` : ""}<h2>جمعية المعلمين الكويتية</h2><p>مكتبة القرطاسية</p>${settings.branch_name ? `<p>${UI.escape(settings.branch_name)}</p>` : ""}${settings.branch_address ? `<p>${UI.escape(settings.branch_address)}</p>` : ""}${settings.branch_phone ? `<p>${UI.escape(settings.branch_phone)}</p>` : ""}</header><div class="receipt-meta">فاتورة: <b class="ltr">${UI.escape(invoice.invoice_no)}</b><br>التاريخ: ${UI.escape(receiptTime)}<br>الكاشير: ${UI.escape(invoice.cashier_name)} · الوردية: ${invoice.shift_no}${invoice.member_name ? "<br>العضو: " + UI.escape(invoice.member_name) : ""}${invoice.offline ? "<br><b>عملية مؤجلة للمزامنة — رقم نهائي بعد الاتصال</b>" : ""}</div><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الصافي</th></tr></thead><tbody>${invoice.items.map((l) => `<tr><td>${UI.escape(l.name_ar)}</td><td>${l.qty}</td><td>${Number(l.unit_price).toFixed(3)}</td><td>${Number(l.line_total).toFixed(3)}</td></tr>`).join("")}</tbody></table><p>المجموع: <span class="money">${UI.money(invoice.subtotal)}</span></p><p>الخصم: <span class="money">${UI.money(invoice.discount_total)}</span></p><p class="receipt-total">الصافي: <span class="money">${UI.money(invoice.net_total)}</span></p>${invoice.payments.map((p) => `<p>${p.payment_method === "cash" ? "نقدًا" : "كي نت"}: <span class="money">${UI.money(p.amount)}</span>${p.reference_no ? " · " + UI.escape(p.reference_no) : ""}</p>`).join("")}<p>الباقي: <span class="money">${UI.money(invoice.change_due)}</span></p><div style="text-align:center;margin-top:12px">${this.barcode(invoice.offline ? invoice.client_transaction_id : invoice.invoice_no)}</div>${settings.return_policy ? `<p style="text-align:center;font-size:10px">${UI.escape(settings.return_policy)}</p>` : ""}`;
    if (!UI.$("receiptModal").open) UI.$("receiptModal").showModal();
  },
  async verifyReturn(invoiceNo) {
    try {
      const sale = await API.request(
        "/returns/verify-invoice/" + encodeURIComponent(invoiceNo),
      );
      const container = UI.$("returnContent");
      container.className = "return-form";
      container.innerHTML = `<p><b>${UI.escape(sale.invoice_no)}</b> · ${UI.escape(sale.cashier_name)} · ${UI.money(sale.net_total)}</p><form id="returnForm"><div class="table-wrap"><table><thead><tr><th>الصنف</th><th>المباع</th><th>المتبقي</th><th>كمية الإرجاع</th><th>الحالة</th></tr></thead><tbody>${sale.items.map((l) => `<tr><td>${UI.escape(l.name_ar)}</td><td>${l.qty}</td><td>${l.remaining_qty}</td><td><input type="number" min="0" max="${l.remaining_qty}" step="0.001" value="0" data-line="${UI.escape(l.id)}" ${l.remaining_qty <= 0 ? "disabled" : ""}></td><td><select data-condition="${UI.escape(l.id)}"><option value="good">سليم</option><option value="damaged">تالف</option></select></td></tr>`).join("")}</tbody></table></div><label style="max-width:500px;margin:16px 0">سبب المرتجع<textarea name="reason" required></textarea></label><button class="primary">تنفيذ المرتجع</button></form>`;
      UI.$("returnForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = e.target.querySelector(".primary");
        b.disabled = true;
        try {
          if (!Auth.shift) throw new Error("افتح وردية أولًا");
          const items = [...e.target.querySelectorAll("[data-line]")]
            .filter((el) => Number(el.value) > 0)
            .map((el) => {
              const l = sale.items.find((l) => l.id === el.dataset.line);
              return {
                sale_line_id: l.id,
                product_id: l.product_id,
                qty: Number(el.value),
                item_condition: e.target.querySelector(
                  `[data-condition="${l.id}"]`,
                ).value,
              };
            });
          const result = await API.request("/returns", "POST", {
            sale_id: sale.id,
            shift_id: Auth.shift.id,
            reason: new FormData(e.target).get("reason"),
            items,
          });
          UI.toast(
            "تم المرتجع " +
              result.return_no +
              " — " +
              UI.money(result.refund_total),
          );
          await this.verifyReturn(invoiceNo);
          await Auth.refreshShift();
          await this.snapshot();
        } catch (err) {
          UI.toast(err.message, true);
          b.disabled = false;
        }
      };
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  beep(success = false) {
    try {
      this.audio =
        this.audio || new (window.AudioContext || window.webkitAudioContext)();
      this.audio.resume();
      const tones = success ? [660, 880] : [1100];
      for (const [i, f] of tones.entries()) {
        const oscillator = this.audio.createOscillator();
        const gain = this.audio.createGain();
        oscillator.frequency.value = f;
        gain.gain.value = 0.04;
        oscillator.connect(gain);
        gain.connect(this.audio.destination);
        oscillator.start(this.audio.currentTime + i * 0.11);
        oscillator.stop(this.audio.currentTime + i * 0.11 + 0.08);
      }
    } catch {}
  },
  async pendingDialog() {
    const pending = (await Offline.pending()).filter(
      (t) => t.offline_user_id === Auth.user.id,
    );
    UI.modal(
      "الاتصال والمزامنة المحلية",
      `<p>${API.online ? "الخادم متصل" : "الخادم غير متصل"} · ${pending.length} فاتورة تنتظر المزامنة</p>${pending.map((t) => `<div class="journal-detail"><b class="ltr">${UI.escape(t.client_transaction_id.slice(0, 8))}</b> · ${UI.money(t.net_total)}<small>${UI.escape(t.queued_at)}</small>${t.sync_error ? `<p class="error">${UI.escape(t.sync_error)}</p><p>راجع المخزون والعضوية والوردية قبل إعادة المحاولة. تبقى العملية محفوظة حتى قبولها من الخادم.</p>` : ""}</div>`).join("")}<footer><button data-close>إغلاق</button><button id="syncNow" class="primary">مزامنة الآن</button></footer>`,
    );
    UI.$("syncNow").onclick = async () => {
      UI.$("syncNow").disabled = true;
      await this.sync(true);
      await this.pendingDialog();
    };
  },
  help() {
    UI.modal(
      "دليل اختصارات لوحة المفاتيح",
      "<table><tbody>" +
        [
          ["F1", "دليل الاختصارات"],
          ["F2", "البحث والباركود"],
          ["F3", "تبديل الكتالوج / جدول السلة"],
          ["F4", "تعليق السلة"],
          ["F7", "شاشة العميل (فتح / اقتران)"],
          ["F8", "التحقق من العضوية"],
          ["F9", "السلات المعلقة"],
          ["F10", "إتمام البيع"],
          ["Esc", "إغلاق النافذة"],
        ]
          .map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`)
          .join("") +
        "</tbody></table><p>بديل مفاتيح الوظائف: Alt + 1، 2، 3، 4، 7، 8، 9، 0 (الأخير لإتمام البيع). إذا نفّذ المفتاح أمر صوت أو سطوع، استخدم Fn مع F أو فعّل Fn Lock من لوحة المفاتيح. يجب أن تكون نافذة النظام هي النشطة.</p>",
    );
  },
};
