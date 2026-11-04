window.Offline = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("kts-pos-local", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("cache");
        r.result.createObjectStore("pending", {
          keyPath: "client_transaction_id",
        });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  },
  async action(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  get(key) {
    return this.action("cache", "readonly", (s) => s.get(key));
  },
  set(key, value) {
    return this.action("cache", "readwrite", (s) => s.put(value, key));
  },
  pending() {
    return this.action("pending", "readonly", (s) => s.getAll());
  },
  remove(id) {
    return this.action("pending", "readwrite", (s) => s.delete(id));
  },
  updatePending(transaction) {
    return this.action("pending", "readwrite", (s) => s.put(transaction));
  },
  async queue(transaction, userId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cache", "pending"], "readwrite");
      tx.objectStore("pending").put({
        ...transaction,
        offline_user_id: userId,
        queued_at: new Date().toISOString(),
      });
      const r = tx.objectStore("cache").get("snapshot");
      r.onsuccess = () => {
        const snapshot = r.result;
        if (snapshot) {
          for (const line of transaction.items) {
            const p = snapshot.products.find((p) => p.id === line.product_id);
            if (p) p.qty_on_hand -= line.qty;
          }
          tx.objectStore("cache").put(snapshot, "snapshot");
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
};
