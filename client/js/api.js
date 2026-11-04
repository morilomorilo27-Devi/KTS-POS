window.UI = {
  $(id) {
    return document.getElementById(id);
  },
  escape(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  },
  money(v) {
    return Number(v || 0).toFixed(3) + " د.ك";
  },
  round(v) {
    return Math.round(Number(v) * 1000) / 1000;
  },
  toast(message, error = false) {
    const el = this.$("toast");
    el.textContent = message;
    el.classList.toggle("error", error);
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (el.hidden = true), 4500);
  },
  modal(title, html) {
    const el = this.$("generalModal");
    this.$("modalTitle").textContent = title;
    this.$("modalBody").innerHTML = html;
    if (!el.open) el.showModal();
    return el;
  },
  icon(name = "box") {
    const paths = {
      box: "M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10",
      basket: "M3 8h18l-2 12H5L3 8zm4 0 5-6 5 6M9 12v4m6-4v4",
      pen: "m4 17-1 4 4-1L20 7l-3-3L4 17zm10-10 3 3",
      book: "M4 3h15v18H4V3zm4 0v18m4-13h4m-4 4h4",
      art: "M3 20h18L3 3v17zm4-4h6L7 9v7",
      file: "M3 6h8l2 3h8v12H3V6zm2-3h7l2 3h6",
      tech: "M3 4h18v13H3V4zm5 17h8m-4-4v4",
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
  },
  async download(path, name) {
    const response = await API.raw(path);
    const blob = await response.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};
window.API = {
  online: true,
  token: localStorage.getItem("kts_token"),
  status(online) {
    this.online = online;
    const el = UI.$("connectionStatus");
    el.textContent = online ? "متصل" : "غير متصل";
    el.classList.toggle("offline", !online);
  },
  async raw(path, options = {}) {
    let response;
    try {
      response = await fetch("/api" + path, {
        ...options,
        headers: {
          ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
          ...(options.headers || {}),
        },
        signal: options.signal || AbortSignal.timeout(12000),
      });
    } catch (error) {
      this.status(false);
      const e = new Error("تعذر الاتصال بالخادم");
      e.offline = true;
      throw e;
    }
    this.status(true);
    const revision=response.headers.get("X-KTS-Access-Revision");
    if(revision && window.Auth?.user?.access_revision && revision!==Auth.user.access_revision && path!=="/auth/me")
      document.dispatchEvent(new Event("accesschanged"));
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || "تعذر إتمام العملية");
      error.status = response.status;
      if (response.status === 401 && path !== "/auth/login")
        document.dispatchEvent(new Event("sessionexpired"));
      throw error;
    }
    return response;
  },
  async request(path, method = "GET", body, options = {}) {
    const form = body instanceof FormData;
    const response = await this.raw(path, {
      ...options,
      method,
      headers: body && !form ? { "Content-Type": "application/json" } : {},
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    return response.json();
  },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-close]");
  if (b) b.closest("dialog").close();
});
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  });
