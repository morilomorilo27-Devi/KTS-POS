/* High-frequency cashier tools. Existing sale calculations and handlers remain authoritative. */
(function () {
  const Enhancements = {
    favoriteIds: new Set(),
    capabilities: {},
    normalize(value) {
      return String(value || "")
        .toLocaleLowerCase("ar")
        .normalize("NFKD")
        .replace(/[\u064B-\u065F]/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    },
    distance(a, b) {
      if (!a) return b.length;
      if (!b) return a.length;
      const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
      for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0];
        previous[0] = i;
        for (let j = 1; j <= b.length; j++) {
          const old = previous[j];
          previous[j] = Math.min(
            previous[j] + 1,
            previous[j - 1] + 1,
            diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
          );
          diagonal = old;
        }
      }
      return previous[b.length];
    },
    async load() {
      try {
        const [favorites, capabilities] = await Promise.all([
          API.request("/pos/favorites"),
          API.request("/devices/pos-capabilities"),
        ]);
        this.favoriteIds = new Set(favorites.map((product) => product.id));
        this.capabilities = capabilities;
        POS.renderProducts();
      } catch (error) {
        if (!error.offline) console.error(error);
      }
    },
    decorateProducts() {
      for (const card of document.querySelectorAll(".product-card")) {
        const productId = card.dataset.productId;
        if (!productId || card.querySelector(".favorite-toggle")) continue;
        const favorite = document.createElement("span");
        favorite.className =
          "favorite-toggle" +
          (this.favoriteIds.has(productId) ? " selected" : "");
        favorite.setAttribute("role", "button");
        favorite.setAttribute("tabindex", "0");
        favorite.setAttribute(
          "aria-label",
          this.favoriteIds.has(productId)
            ? "إزالة من المفضلة"
            : "إضافة إلى المفضلة",
        );
        favorite.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z"/></svg>';
        const toggle = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            const result = await API.request(
              "/pos/favorites/" + productId,
              "POST",
              {},
            );
            if (result.favorite) this.favoriteIds.add(productId);
            else this.favoriteIds.delete(productId);
            POS.renderProducts();
          } catch (error) {
            UI.toast(error.message, true);
          }
        };
        favorite.onclick = toggle;
        favorite.onkeydown = (event) => {
          if (["Enter", " "].includes(event.key)) toggle(event);
        };
        card.prepend(favorite);
      }
      if (POS.showFavorites) {
        for (const card of document.querySelectorAll(".product-card"))
          if (!this.favoriteIds.has(card.dataset.productId)) card.remove();
        UI.$("catalogTitle").textContent = "الأصناف المفضلة";
        UI.$("catalogCount").textContent = this.favoriteIds.size + " صنف";
      }
    },
    showAlternatives(product) {
      const alternatives = POS.products
        .filter(
          (candidate) =>
            candidate.id !== product.id &&
            candidate.category_id === product.category_id &&
            candidate.status === "active" &&
            candidate.qty_on_hand > 0,
        )
        .sort(
          (a, b) =>
            Math.abs(a.sale_price - product.sale_price) -
            Math.abs(b.sale_price - product.sale_price),
        )
        .slice(0, 6);
      const dialog = UI.modal(
        "الصنف غير متوفر — البدائل",
        alternatives.length
          ? `<p>اختر بديلًا متوفرًا من الفئة نفسها.</p><div class="alternative-products">${alternatives.map((item) => `<button data-alternative="${item.id}"><span><strong>${UI.escape(item.name_ar)}</strong><small>${UI.escape(item.sku)} · متوفر ${item.qty_on_hand}</small></span><b class="money">${UI.money(item.sale_price)}</b></button>`).join("")}</div>`
          : "<p>لا توجد بدائل متوفرة ضمن الفئة نفسها.</p>",
      );
      for (const button of dialog.querySelectorAll("[data-alternative]"))
        button.onclick = () => {
          const alternative = POS.products.find(
            (item) => item.id === button.dataset.alternative,
          );
          dialog.close();
          POS.add(alternative);
        };
    },
    quantityPad() {
      if (!POS.cart.length) return UI.toast("أضف صنفًا إلى السلة أولًا", true);
      const latest = POS.lastScannedProductId || POS.cart.at(-1).product_id;
      const dialog = UI.modal(
        "تعديل الكمية",
        `<div class="quantity-product"><label>الصنف<select id="quantityProduct">${POS.cart.map((line) => {
          const product = POS.products.find((item) => item.id === line.product_id);
          return `<option value="${line.product_id}" ${line.product_id === latest ? "selected" : ""}>${UI.escape(product?.name_ar)}</option>`;
        }).join("")}</select></label><output id="quantityDisplay">1</output></div><div class="number-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, ".", 0, "⌫"].map((key) => `<button data-key="${key}">${key}</button>`).join("")}</div><footer><button data-close>إلغاء</button><button id="applyQuantity" class="primary">اعتماد الكمية</button></footer>`,
      );
      const output = UI.$("quantityDisplay");
      const sync = () => {
        const line = POS.cart.find(
          (item) => item.product_id === UI.$("quantityProduct").value,
        );
        output.value = String(line.qty);
        output.textContent = String(line.qty);
      };
      sync();
      UI.$("quantityProduct").onchange = sync;
      for (const button of dialog.querySelectorAll("[data-key]"))
        button.onclick = () => {
          const key = button.dataset.key;
          let value = output.value || output.textContent || "";
          if (key === "⌫") value = value.slice(0, -1) || "0";
          else if (key === "." && value.includes(".")) return;
          else value = value === "0" && key !== "." ? key : value + key;
          output.value = value;
          output.textContent = value;
        };
      UI.$("applyQuantity").onclick = async () => {
        const line = POS.cart.find(
          (item) => item.product_id === UI.$("quantityProduct").value,
        );
        const product = POS.products.find((item) => item.id === line.product_id);
        const qty = Number(output.value || output.textContent);
        if (!Number.isFinite(qty) || qty <= 0)
          return UI.toast("الكمية غير صالحة", true);
        if (qty > product.qty_on_hand)
          return UI.toast("المخزون غير كافٍ", true);
        if (qty >= 10 && !dialog.classList.contains("quantity-confirmed")) {
          dialog.classList.add("quantity-confirmed");
          UI.$("applyQuantity").textContent = `تأكيد الكمية الكبيرة (${qty})`;
          UI.toast("راجع الكمية الكبيرة ثم اضغط التأكيد مرة أخرى");
          return;
        }
        line.qty = qty;
        POS.txId = null;
        dialog.close();
        await POS.calculate();
      };
    },
    async trainingCheckout() {
      if (!POS.cart.length) return;
      await POS.calculate();
      const invoice = {
        id: "training-" + crypto.randomUUID(),
        invoice_no: "تدريب — لا تُسجل",
        cashier_name: Auth.user.full_name,
        shift_no: Auth.shift?.shift_no || "—",
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        subtotal: POS.totals.subtotal,
        discount_total: POS.totals.discount_total,
        net_total: POS.totals.net_total,
        change_due: 0,
        payments: [{ payment_method: POS.payment === "knet" ? "knet" : "cash", amount: POS.totals.net_total }],
        items: POS.totals.items.map((line) => ({
          ...line,
          name_ar: POS.products.find((product) => product.id === line.product_id)?.name_ar,
        })),
        training: true,
      };
      await POS.clear();
      await POS.receipt(invoice);
      UI.$("receiptPaper").insertAdjacentHTML(
        "afterbegin",
        '<div class="training-watermark">نسخة تدريب — غير مالية</div>',
      );
      UI.toast("انتهت المعاملة التدريبية دون تسجيل بيع أو خصم مخزون");
    },
    async openLastReceipt() {
      try {
        const invoice = POS.lastInvoice || (await API.request("/pos/last-invoice"));
        if (!invoice) return UI.toast("لا توجد فاتورة سابقة", true);
        POS.reprintMode = true;
        await POS.receipt(invoice);
      } catch (error) {
        UI.toast(error.message, true);
      }
    },
    async reprint() {
      if (!POS.lastInvoice || POS.lastInvoice.offline || POS.lastInvoice.training)
        return Printing.receipt();
      const dialog = UI.modal(
        "اعتماد إعادة الطباعة",
        '<form id="reprintForm"><p>تُسجل إعادة الطباعة وسببها في سجل التدقيق.</p><label>السبب<input name="reason" required autofocus></label><footer><button type="button" data-close>إلغاء</button><button class="primary">تسجيل وطباعة</button></footer></form>',
      );
      UI.$("reprintForm").onsubmit = async (event) => {
        event.preventDefault();
        try {
          await API.request(
            `/pos/invoices/${POS.lastInvoice.id}/reprint`,
            "POST",
            Object.fromEntries(new FormData(event.target)),
          );
          dialog.close();
          POS.reprintMode = false;
          Printing.receipt();
        } catch (error) {
          UI.toast(error.message, true);
        }
      };
    },
    async decorateReceipt(invoice) {
      if (invoice.offline || invoice.training) return;
      try {
        const electronic = await API.request(`/receipts/${invoice.id}/electronic`);
        UI.$("receiptPaper").insertAdjacentHTML(
          "beforeend",
          `<div class="receipt-verification"><div>${electronic.qr_svg}</div><p>رمز التحقق<br><b class="ltr">${UI.escape(electronic.verification_value)}</b></p></div>`,
        );
        let tools = UI.$("digitalReceiptTools");
        if (!tools) {
          tools = document.createElement("div");
          tools.id = "digitalReceiptTools";
          tools.className = "digital-receipt-tools";
          UI.$("receiptModal").querySelector("footer").prepend(tools);
        }
        tools.innerHTML = '<button data-channel="email">إرسال بالبريد</button><button data-channel="message">إرسال برسالة</button>';
        for (const button of tools.querySelectorAll("[data-channel]"))
          button.onclick = () => this.deliveryDialog(invoice, button.dataset.channel);
      } catch (error) {
        if (!error.offline) console.error(error);
      }
    },
    deliveryDialog(invoice, channel) {
      const dialog = UI.modal(
        "إرسال الفاتورة الإلكترونية",
        `<form id="receiptDeliveryForm"><p>لن تُرسل بيانات العضو إلا بعد تسجيل موافقته.</p><label>${channel === "email" ? "البريد الإلكتروني" : "رقم الهاتف"}<input name="destination" type="${channel === "email" ? "email" : "tel"}" value="${UI.escape(channel === "email" ? POS.member?.email || "" : POS.member?.phone || "")}" required></label><label class="consent-check"><input name="consent" type="checkbox" value="1" required> أؤكد موافقة العضو على استلام الفاتورة عبر هذه القناة</label><footer><button type="button" data-close>إلغاء</button><button class="primary">إرسال</button></footer></form>`,
      );
      UI.$("receiptDeliveryForm").onsubmit = async (event) => {
        event.preventDefault();
        try {
          const data = Object.fromEntries(new FormData(event.target));
          data.channel = channel;
          data.consent = Boolean(data.consent);
          const result = await API.request(`/receipts/${invoice.id}/deliver`, "POST", data);
          dialog.close();
          UI.toast(
            result.delivery_status === "queued"
              ? "أضيفت الفاتورة إلى قائمة الإرسال"
              : "حُفظ الطلب؛ أكمل إعداد مزود الإرسال من الأجهزة",
          );
        } catch (error) {
          UI.toast(error.message, true);
        }
      };
    },
    async decorateMember() {
      if (!POS.member) return;
      try {
        const summary = await API.request(`/pos/members/${POS.member.id}/summary`);
        const card = UI.$("member-profile-card");
        card.querySelector(".member-insight")?.remove();
        card.insertAdjacentHTML(
          "beforeend",
          `<div class="member-insight"><span>آخر عملية <b>${summary.last_purchase_at ? UI.escape(summary.last_purchase_at.slice(0, 10)) : "لا توجد"}</b></span><span>إجمالي التوفير <b class="money">${UI.money(summary.total_savings)}</b></span>${summary.remaining_limit != null ? `<span>المتاح من الحد <b class="money">${UI.money(summary.remaining_limit)}</b></span>` : ""}<button type="button" class="member-benefits-button">الرصيد والقسائم</button>${summary.expiry_warning ? '<strong>تنبيه: العضوية قاربت على الانتهاء</strong>' : ""}</div>`,
        );
        card.querySelector(".member-benefits-button").onclick = () =>
          this.memberBenefits(summary);
      } catch (error) {
        if (!error.offline) console.error(error);
      }
    },
    memberBenefits(summary) {
      const dialog = UI.modal(
        "رصيد ومزايا العضو",
        `<div class="member-benefit-picker"><div class="wallet-balance"><span>رصيد المحفظة</span><strong class="money">${UI.money(summary.wallet_balance)}</strong></div><label>المبلغ المستخدم في هذه الفاتورة<input id="memberWalletAmount" type="number" min="0" max="${summary.wallet_balance}" step="0.001" value="${POS.walletAmount || 0}"></label><button id="applyWallet">تطبيق الرصيد</button><h3>القسائم الفعالة</h3><div class="voucher-options">${summary.vouchers.length ? summary.vouchers.map((voucher) => `<button data-voucher="${UI.escape(voucher.code)}" class="${POS.voucherCode === voucher.code ? "selected" : ""}"><span><b>${UI.escape(voucher.code)}</b><small>صالح حتى ${UI.escape(voucher.expires_at || "دون تاريخ")}</small></span><strong class="money">${UI.money(voucher.remaining_value)}</strong></button>`).join("") : "<p>لا توجد قسائم فعالة لهذا العضو.</p>"}</div><footer><button id="clearMemberBenefits">إلغاء المزايا المطبقة</button><button data-close class="primary">تم</button></footer></div>`,
      );
      UI.$("applyWallet").onclick = async () => {
        POS.walletAmount = Number(UI.$("memberWalletAmount").value || 0);
        dialog.close();
        await POS.calculate();
        UI.toast("تم تطبيق رصيد المحفظة على العملية");
      };
      for (const button of dialog.querySelectorAll("[data-voucher]"))
        button.onclick = async () => {
          POS.voucherCode = button.dataset.voucher;
          dialog.close();
          await POS.calculate();
          UI.toast("تم تطبيق القسيمة");
        };
      UI.$("clearMemberBenefits").onclick = async () => {
        POS.voucherCode = null;
        POS.walletAmount = 0;
        dialog.close();
        await POS.calculate();
      };
    },
    async scaleBarcode(code) {
      try {
        const parsed = await API.request("/devices/scale/parse", "POST", {
          barcode: code,
        });
        if (!parsed.weighted) return false;
        const product = POS.products.find(
          (item) => item.sku === parsed.sku || item.barcodes.includes(parsed.sku),
        );
        if (!product) throw new Error("صنف الميزان غير موجود");
        let line = POS.cart.find((item) => item.product_id === product.id);
        if (line) line.qty = UI.round(line.qty + parsed.weight);
        else POS.cart.push({ product_id: product.id, qty: parsed.weight });
        POS.lastScannedProductId = product.id;
        POS.txId = null;
        await POS.calculate();
        POSDesign.announceAdded(product);
        UI.$("posSearchInput").value = "";
        return true;
      } catch (error) {
        UI.toast(error.message, true);
        return true;
      }
    },
  };

  window.POSEnhancements = Enhancements;

  const originalInit = POS.init;
  POS.init = async function (...args) {
    const value = await originalInit.apply(this, args);
    await Enhancements.load();
    return value;
  };

  const originalRenderProducts = POS.renderProducts;
  POS.renderProducts = function (...args) {
    const value = originalRenderProducts.apply(this, args);
    Enhancements.decorateProducts();
    return value;
  };

  const originalMatch = POS.match;
  POS.match = function (product, query) {
    if (originalMatch.call(this, product, query)) return true;
    const needle = Enhancements.normalize(query);
    if (needle.length < 3) return false;
    return [product.name_ar, product.name_en, product.sku]
      .filter(Boolean)
      .some((value) => {
        const normalized = Enhancements.normalize(value);
        return normalized
          .split(" ")
          .some((word) =>
            word.length >= 3
              ? Enhancements.distance(word, needle) <=
                Math.max(1, Math.floor(needle.length / 4))
              : false,
          );
      });
  };

  const originalAdd = POS.add;
  POS.add = function (product) {
    const line = this.cart.find((item) => item.product_id === product.id);
    if ((line?.qty || 0) + 1 > product.qty_on_hand) {
      Enhancements.showAlternatives(product);
      return false;
    }
    const result = originalAdd.call(this, product);
    if (result) {
      this.lastScannedProductId = product.id;
      if (line && line.qty >= 5)
        UI.toast(`تنبيه: أصبحت كمية ${product.name_ar} في السلة ${line.qty}`);
    }
    return result;
  };

  const originalCheckout = POS.checkout;
  POS.checkout = async function () {
    if(!Auth.can("pos_checkout"))return UI.toast("لا تملك صلاحية إتمام البيع",true);
    if (this.trainingMode) return Enhancements.trainingCheckout();
    this.reprintMode = false;
    const hasKnet = this.payment === "knet" || this.payment === "split";
    if (hasKnet && API.online && Enhancements.capabilities.knet?.active) {
      try {
        this.txId = this.txId || crypto.randomUUID();
        const amount =
          this.payment === "split"
            ? Number(UI.$("splitKnet").value)
            : this.totals.net_total;
        const transaction = await API.request("/devices/knet/charge", "POST", {
          amount,
          client_reference: this.txId,
        });
        if (transaction.status !== "approved")
          throw new Error("لم يعتمد جهاز K-Net العملية");
        this.knetClientReference = transaction.client_reference;
        UI.$("knetReference").value = transaction.terminal_reference;
      } catch (error) {
        UI.toast(error.message, true);
        return;
      }
    }
    return originalCheckout.call(this);
  };

  const originalReceipt = POS.receipt;
  POS.receipt = async function (invoice) {
    const value = await originalReceipt.call(this, invoice);
    await Enhancements.decorateReceipt(invoice);
    return value;
  };

  const originalRenderMember = POS.renderMember;
  POS.renderMember = function () {
    const value = originalRenderMember.call(this);
    Enhancements.decorateMember();
    return value;
  };

  const originalBind = POS.bind;
  POS.bind = function () {
    originalBind.call(this);
    UI.$("printReceipt").onclick = () =>
      this.reprintMode ? Enhancements.reprint() : Printing.receipt();
    UI.$("favoritesFilter").onclick = () => {
      this.showFavorites = !this.showFavorites;
      UI.$("favoritesFilter").classList.toggle("active", this.showFavorites);
      UI.$("favoritesFilter").setAttribute(
        "aria-pressed",
        String(this.showFavorites),
      );
      this.renderProducts();
    };
    UI.$("repeatLastProduct").onclick = () => {
      const product = this.products.find(
        (item) => item.id === this.lastScannedProductId,
      );
      if (product) this.add(product);
      else UI.toast("لا يوجد صنف سابق في هذه المعاملة", true);
    };
    UI.$("quantityKeypad").onclick = () => Enhancements.quantityPad();
    UI.$("lastReceiptButton").onclick = () => Enhancements.openLastReceipt();
    UI.$("posSearchInput").addEventListener(
      "keydown",
      (event) => {
        const value = event.currentTarget.value.trim();
        if (event.key === "Enter" && /^2\d{11,}$/.test(value)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          Enhancements.scaleBarcode(value);
        }
      },
      true,
    );
  };

  const originalHeldDialog = POS.heldDialog;
  POS.heldDialog = async function () {
    await originalHeldDialog.call(this);
    const dialog = UI.$("generalModal");
    const options = [...dialog.querySelectorAll("[data-cart]")].filter(
      (button) => !button.dataset.cart.startsWith("LOCAL-"),
    );
    if (!options.length) return;
    for (const button of options) {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "held-select";
      check.onclick = (event) => event.stopPropagation();
      button.prepend(check);
    }
    const tools = document.createElement("div");
    tools.className = "held-cart-tools";
    tools.innerHTML = '<button id="mergeHeldCarts">دمج المحدد</button>';
    if (["role-admin", "role-supervisor"].includes(Auth.user.role_id))
      tools.insertAdjacentHTML(
        "beforeend",
        '<button id="transferHeldCart">نقل المحدد</button>',
      );
    UI.$("modalBody").prepend(tools);
    UI.$("mergeHeldCarts").onclick = async () => {
      const ids = options
        .filter((button) => button.querySelector(".held-select").checked)
        .map((button) => button.dataset.cart);
      try {
        await API.request("/pos/held-carts/merge", "POST", { ids });
        dialog.close();
        UI.toast("تم دمج السلات المعلقة");
      } catch (error) {
        UI.toast(error.message, true);
      }
    };
    if (UI.$("transferHeldCart"))
      UI.$("transferHeldCart").onclick = async () => {
        const selected = options.filter(
          (button) => button.querySelector(".held-select").checked,
        );
        if (selected.length !== 1)
          return UI.toast("حدد سلة واحدة للنقل", true);
        const targets = await API.request("/pos/transfer-targets");
        const transfer = UI.modal(
          "نقل السلة بموافقة المشرف",
          `<form id="cartTransferForm"><label>الكاشير المستهدف<select name="target_user_id">${targets.filter((user) => user.id !== Auth.user.id).map((user) => `<option value="${user.id}">${UI.escape(user.full_name)}</option>`).join("")}</select></label><footer><button type="button" data-close>إلغاء</button><button class="primary">اعتماد النقل</button></footer></form>`,
        );
        UI.$("cartTransferForm").onsubmit = async (event) => {
          event.preventDefault();
          await API.request(
            `/pos/held-carts/${selected[0].dataset.cart}/transfer`,
            "POST",
            Object.fromEntries(new FormData(event.target)),
          );
          transfer.close();
          UI.toast("تم نقل السلة وتسجيل موافقة المشرف");
        };
      };
  };
})();
