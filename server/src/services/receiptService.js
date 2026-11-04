const crypto = require("node:crypto");
const d = require("../db");
const audit = require("./auditService");

function gfTables() {
  const exp = new Array(512);
  const log = new Array(256).fill(0);
  let value = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = value;
    log[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
const gf = gfTables();
const multiply = (a, b) => (!a || !b ? 0 : gf.exp[gf.log[a] + gf.log[b]]);

function ecc(data, degree = 15) {
  let generator = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      next[j] ^= generator[j];
      next[j + 1] ^= multiply(generator[j], gf.exp[i]);
    }
    generator = next;
  }
  const result = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = result[i];
    if (!factor) continue;
    for (let j = 0; j < generator.length; j++)
      result[i + j] ^= multiply(generator[j], factor);
  }
  return result.slice(-degree);
}

function qrMatrix(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  if (bytes.length > 53) throw new Error("بيانات QR طويلة");
  const bits = [0, 1, 0, 0];
  for (let i = 7; i >= 0; i--) bits.push((bytes.length >> i) & 1);
  for (const byte of bytes)
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  for (let i = 0; i < 4 && bits.length < 440; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  for (let pad = 0; data.length < 55; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const codewords = [...data, ...ecc(data)];
  const stream = codewords.flatMap((byte) =>
    Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1),
  );
  const size = 29;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, value, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = Boolean(value);
    if (reserve) reserved[y][x] = true;
  };
  const finder = (x, y) => {
    for (let dy = -1; dy <= 7; dy++)
      for (let dx = -1; dx <= 7; dx++)
        set(
          x + dx,
          y + dy,
          dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
            (dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
              (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)),
        );
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      set(22 + dx, 22 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  const formatA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const formatB = [
    [28, 8], [27, 8], [26, 8], [25, 8], [24, 8], [23, 8], [22, 8], [21, 8],
    [8, 22], [8, 23], [8, 24], [8, 25], [8, 26], [8, 27], [8, 28],
  ];
  const format = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = (format >> i) & 1;
    set(formatA[i][0], formatA[i][1], bit);
    set(formatB[i][0], formatB[i][1], bit);
  }
  set(8, size - 8, true);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (reserved[y][x]) continue;
        const bit = index < stream.length ? stream[index++] : 0;
        matrix[y][x] = Boolean(bit ^ ((x + y) % 2 === 0));
      }
    }
  }
  return matrix;
}

function qrSvg(text, scale = 4) {
  const matrix = qrMatrix(text);
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const paths = [];
  matrix.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell) paths.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${paths.join("")}" fill="#111"/></svg>`;
}

function ensure(saleId, consent = false) {
  let row = d.get("SELECT * FROM electronic_receipts WHERE sale_id=?", saleId);
  if (!row) {
    row = d.insert("electronic_receipts", {
      id: d.id(),
      sale_id: saleId,
      verification_token: crypto.randomBytes(6).toString("hex").toUpperCase(),
      member_consent: consent ? 1 : 0,
    });
  }
  return row;
}

function verify(token) {
  const row = d.get(
    `SELECT e.verification_token,s.id,s.invoice_no,s.subtotal,s.discount_total,s.net_total,s.status,s.created_at,
      m.name member_name,u.full_name cashier_name FROM electronic_receipts e JOIN sales s ON s.id=e.sale_id
      LEFT JOIN members m ON m.id=s.member_id JOIN users u ON u.id=s.user_id WHERE e.verification_token=?`,
    String(token || "").replace(/^KTS:/i, "").toUpperCase(),
  );
  if (!row) d.fail("رمز الفاتورة غير صالح", 404);
  return row;
}

function details(saleId, baseUrl = "") {
  const receipt = ensure(saleId);
  const verificationValue = `${String(baseUrl).replace(/\/$/, "")}/r/${receipt.verification_token}`;
  return {
    ...receipt,
    qr_svg: qrSvg(verificationValue),
    verification_value: verificationValue,
  };
}

function deliver(user, saleId, body) {
  const receipt = ensure(saleId, body.consent);
  if (!body.consent) d.fail("موافقة العضو مطلوبة لإرسال الفاتورة");
  if (!['email','message'].includes(body.channel)) d.fail("قناة الإرسال غير صالحة");
  const destination = d.required(body.destination, "وجهة الإرسال");
  const action = d.insert("receipt_actions", {
    id: d.id(),
    sale_id: saleId,
    action: body.channel,
    destination,
    user_id: user.id,
  });
  const job = d.insert("device_jobs", {
    id: d.id(),
    device_type: "electronic_delivery",
    job_type: `electronic_${body.channel}`,
    payload: JSON.stringify({
      sale_id: saleId,
      destination,
      verification_token: receipt.verification_token,
    }),
    status: "queued",
    user_id: user.id,
  });
  d.run(
    `UPDATE electronic_receipts SET member_consent=1,${body.channel === "email" ? "email_status" : "message_status"}=? WHERE sale_id=?`,
    "queued",
    saleId,
  );
  audit.record(user, "receipt_delivery_request", "sales", saleId, null, action);
  return { ...action, delivery_status: "queued", job_id: job.id };
}

module.exports = { ensure, verify, details, deliver, qrSvg };
