window.PWA = {
  installPrompt: null,
  init() {
    const button = document.getElementById("installAppButton");
    if (!button) return;
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (installed) button.hidden = true;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.installPrompt = event;
      button.hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      this.installPrompt = null;
      button.hidden = true;
      UI.toast("تم تثبيت النظام على الجهاز");
    });
    button.addEventListener("click", async () => {
      if (!this.installPrompt) return;
      button.disabled = true;
      try {
        await this.installPrompt.prompt();
        await this.installPrompt.userChoice;
        this.installPrompt = null;
        button.hidden = true;
      } finally {
        button.disabled = false;
      }
    });
  },
};

window.addEventListener("DOMContentLoaded", () => PWA.init());
