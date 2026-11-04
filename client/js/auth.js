window.Auth = {
  user: null,
  shift: null,
  can(permission) {
    if (permission === "customer_display_open") {
      return Boolean(this.user?.permissions?.includes("customer_display_open") || this.user?.permissions?.includes("pos_sale") || this.user?.role_id === "role-admin");
    }
    return Boolean(this.user?.permissions?.includes(permission));
  },
  async init() {
    UI.$("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(e.target));
        const result = await API.request("/auth/login", "POST", data);
        API.token = result.token;
        localStorage.setItem("kts_token", result.token);
        await this.enter(result.user);
      } catch (err) {
        UI.$("loginError").textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
    UI.$("logoutButton").onclick = () => this.logout();
    UI.$("shiftButton").onclick = () => this.shiftDialog();
    document.addEventListener("sessionexpired", () => {
      this.user = null;
      document.body.classList.remove("admin-mode");
      document.body.classList.remove("pos-mode");
      UI.$("appShell").hidden = true;
      UI.$("loginScreen").hidden = false;
      UI.$("loginError").textContent = "انتهت الجلسة، يرجى تسجيل الدخول مجددًا";
    });
    for (const b of document.querySelectorAll("[data-view]"))
      b.onclick = () => this.view(b.dataset.view);
    if (API.token) {
      try {
        const data = await API.request("/auth/me");
        await this.enter(data.user);
      } catch (e) {
        if (e.offline) {
          const cached = await Offline.get("user");
          if (cached) await this.enter(cached, true);
        } else localStorage.removeItem("kts_token");
      }
    }
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  },
  async enter(user, offline = false) {
    this.user = user;
    await Offline.set("user", user);
    UI.$("cashierName").textContent = user.full_name;
    UI.$("appShell").hidden = false;
    UI.$("loginScreen").hidden = true;
    UI.$("adminNav").hidden =
      !Admin.sections.some(section=>this.can(section[2]));
    for(const button of document.querySelectorAll('[data-view="pos"]')) button.hidden=!this.can("pos_sale");
    for(const button of document.querySelectorAll('[data-view="returns"]')) button.hidden=!this.can("pos_return");
    UI.$("shiftButton").hidden=!this.can("pos_sale");
    if(this.can("pos_sale")) {
      await POS.init(offline);
      await this.refreshShift(offline);
    }
    else if(!POS.bound){POS.bind();POS.bound=true;}
    const logo = UI.$("brandLogo");
    logo.onload = () => {
      logo.hidden = false;
      UI.$("brandFallback").hidden = true;
    };
    if (logo.complete && logo.naturalWidth) logo.onload();
    this.view(this.can("pos_sale") ? "pos" : !UI.$("adminNav").hidden ? "admin" : this.can("pos_return") ? "returns" : "restricted");
    if(this.can("pos_sale"))UI.$("posSearchInput").focus();
  },
  async refreshShift(offline = false) {
    if (offline) {
      this.shift = (await Offline.get("snapshot"))?.shift || null;
    } else this.shift = await API.request("/shifts/current");
    if (this.shift && this.shift.user_id !== this.user.id) this.shift = null;
    UI.$("shiftButton").textContent = this.shift
      ? "وردية " + this.shift.shift_no
      : "فتح وردية";
  },
  view(name) {
    if(name==="pos"&&!this.can("pos_sale"))return;
    if(name==="returns"&&!this.can("pos_return"))return;
    if (name === "admin" && UI.$("adminNav").hidden) return;
    document.body.classList.toggle("admin-mode", name === "admin");
    document.body.classList.toggle("pos-mode", name === "pos");
    for (const v of ["pos", "returns", "admin"])
      UI.$(v + "View").hidden = v !== name;
    for (const b of document.querySelectorAll("[data-view]"))
      b.classList.toggle("active", b.dataset.view === name);
    this.viewName = name;
    if (name === "admin") Admin.init();
  },
  async shiftDialog() {
    try {
      const pending = (await Offline.pending()).filter(
        (t) => t.offline_user_id === this.user.id,
      );
      const localHeld = (
        (await Offline.get("held:" + this.user.id)) || []
      ).filter((c) => c.shift_id === this.shift?.id);
      if (this.shift && (POS.cart.length || localHeld.length)) {
        UI.toast(
          "أتم السلة الحالية واسترجع السلات المعلقة قبل إغلاق الوردية",
          true,
        );
        return;
      }
      if (pending.length && this.shift) {
        UI.toast(
          "يجب مزامنة " + pending.length + " فاتورة مؤجلة قبل إغلاق الوردية",
          true,
        );
        return;
      }
      const closing = Boolean(this.shift);
      const dialog = UI.modal(
        closing ? "إغلاق الوردية ومطابقة النقد" : "فتح وردية جديدة",
        `<form id="shiftForm"><label>${closing ? "النقد الفعلي في الدرج" : "رصيد افتتاح الدرج"}<input name="amount" type="number" min="0" step="0.001" required autofocus></label><label style="margin-top:16px">ملاحظات<textarea name="notes"></textarea></label><footer><button type="button" data-close>إلغاء</button><button class="primary">${closing ? "إغلاق الوردية وإصدار Z" : "بدء الوردية"}</button></footer></form>`,
      );
      UI.$("shiftForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = e.target.querySelector(".primary");
        b.disabled = true;
        try {
          const form = Object.fromEntries(new FormData(e.target));
          const result = await API.request(
            "/shifts/" + (closing ? "close" : "open"),
            "POST",
            {
              [closing ? "actual_cash" : "opening_cash"]: Number(form.amount),
              notes: form.notes,
            },
          );
          dialog.close();
          await this.refreshShift();
          await POS.snapshot();
          if (closing) {
            UI.modal(
              "تقرير إقفال الوردية Z",
              `<p>الوردية ${result.shift_no}</p><p>النقد المتوقع: <b class="money">${UI.money(result.expected_cash)}</b></p><p>النقد الفعلي: <b class="money">${UI.money(result.actual_cash)}</b></p><p>الفارق: <b class="money">${UI.money(result.discrepancy)}</b></p><p>صافي المبيعات: ${UI.money(result.total_sales)}</p><p>المرتجعات: ${UI.money(result.total_refunds)}</p><footer><button data-close>إغلاق</button></footer>`,
            );
          } else UI.toast("تم فتح الوردية");
        } catch (err) {
          UI.toast(err.message, true);
        } finally {
          b.disabled = false;
        }
      };
    } catch (e) {
      UI.toast(e.message, true);
    }
  },
  async logout() {
    if (POS.cart.length) {
      UI.toast("أتم البيع أو علّق السلة قبل الخروج", true);
      return;
    }
    try {
      await API.request("/auth/logout", "POST");
    } catch {}
    localStorage.removeItem("kts_token");
    API.token = null;
    this.user = null;
    document.body.classList.remove("admin-mode");
    document.body.classList.remove("pos-mode");
    UI.$("appShell").hidden = true;
    UI.$("loginScreen").hidden = false;
  },
};
window.addEventListener("DOMContentLoaded", () =>
  Auth.init().catch((e) => UI.toast(e.message, true)),
);
