const https = require("https");
const zlib  = require("zlib");

/* ================= CONFIG — WAJIB DIISI ================= */
const BOT_TOKEN        = "7759700496:AAH9KkZ8As1Ei-uhXE3q1yMdnTkry99EcWA";   // dari @BotFather
const CHAT_ID          = "-1003456876412";      // chat/group tujuan notif
const ADMIN_IDS        = [                           // Telegram user_id yang boleh set cookie
  7442993900,   // ganti dengan user_id kamu
  // 987654321, // tambah admin lain
];
const POLL_INTERVAL_MS = 30_000;                     // cek SMS tiap 30 detik

/* ================= IVAS CONFIG ================= */
const BASE_URL   = "https://www.ivasms.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";

let COOKIES = {
  "XSRF-TOKEN":       "",
  "ivas_sms_session": ""
};

const userState = {}; // track state per admin

/* ================= COOKIE HELPERS ================= */
function cookieString() {
  return Object.entries(COOKIES).map(([k, v]) => `${k}=${v}`).join("; ");
}
function getXsrf() {
  try { return decodeURIComponent(COOKIES["XSRF-TOKEN"] || ""); }
  catch { return COOKIES["XSRF-TOKEN"] || ""; }
}

// Extract XSRF-TOKEN dan ivas_sms_session dari cookie string mentah browser
function parseCookieString(raw) {
  const result = {};
  raw.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.substring(0, idx).trim();
    const v = part.substring(idx + 1).trim();
    if (k === "XSRF-TOKEN" || k === "ivas_sms_session") result[k] = v;
  });
  return result;
}

/* ================= HTTP HELPER ================= */
function makeRequest(method, path, body, contentType, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent":       USER_AGENT,
      "Accept":           "*/*",
      "Accept-Encoding":  "gzip, deflate, br",
      "Accept-Language":  "en-PK,en;q=0.9",
      "Cookie":           cookieString(),
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN":     getXsrf(),
      "X-CSRF-TOKEN":     getXsrf(),
      "Origin":           BASE_URL,
      "Referer":          `${BASE_URL}/portal`,
      ...extraHeaders
    };
    if (method === "POST" && body) {
      headers["Content-Type"]   = contentType;
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = https.request(BASE_URL + path, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const sc = c.split(";")[0];
          const ki = sc.indexOf("=");
          if (ki > -1) {
            const k = sc.substring(0, ki).trim();
            const v = sc.substring(ki + 1).trim();
            if (k === "XSRF-TOKEN" || k === "ivas_sms_session") COOKIES[k] = v;
          }
        });
      }
      let chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = res.headers["content-encoding"];
          if (enc === "gzip") buf = zlib.gunzipSync(buf);
          else if (enc === "br") buf = zlib.brotliDecompressSync(buf);
        } catch {}
        const text = buf.toString("utf-8");
        if (res.statusCode === 401 || res.statusCode === 419 ||
            text.includes('"message":"Unauthenticated"')) {
          return reject(new Error("SESSION_EXPIRED"));
        }
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ================= FETCH CSRF TOKEN ================= */
async function fetchToken() {
  const resp = await makeRequest("GET", "/portal", null, null, {
    "Accept": "text/html,application/xhtml+xml,*/*"
  });
  const match = resp.body.match(/name="_token"\s+value="([^"]+)"/) ||
                resp.body.match(/"csrf-token"\s+content="([^"]+)"/);
  return match ? match[1] : null;
}

/* ================= AMBIL SMS ================= */
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function clean(t) {
  return (t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&amp;/g,"&").replace(/&#039;/g,"'")
    .replace(/\s+/g," ").trim();
}
function parseSMSMessages(html, range, number, date) {
  const rows  = [];
  const trAll = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const trM of trAll) {
    const row = trM[1];
    if (row.includes("<th")) continue;
    const senderM = row.match(/class="cli-tag"[^>]*>([^<]+)</);
    const sender  = senderM ? senderM[1].trim() : "SMS";
    const msgM    = row.match(/class="msg-text"[^>]*>([\s\S]*?)<\/div>/i);
    const message = msgM ? clean(msgM[1]) : "";
    const timeM   = row.match(/class="time-cell"[^>]*>\s*([0-9:]+)\s*</);
    const time    = timeM ? timeM[1].trim() : "00:00:00";
    if (message) rows.push({ datetime: `${date} ${time}`, range, number, sender, message });
  }
  return rows;
}
async function fetchAllSMS() {
  const token    = await fetchToken();
  if (!token) throw new Error("SESSION_EXPIRED");
  const today    = getToday();
  const boundary = "----WebKitFormBoundary6I2Js7TBhcJuwIqw";
  const parts    = [
    `--${boundary}\r\nContent-Disposition: form-data; name="from"\r\n\r\n${today}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="to"\r\n\r\n${today}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="_token"\r\n\r\n${token}`,
    `--${boundary}--`
  ].join("\r\n");

  const r1     = await makeRequest("POST", "/portal/sms/received/getsms", parts,
    `multipart/form-data; boundary=${boundary}`,
    { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
  );
  const ranges = [...r1.body.matchAll(/toggleRange\('([^']+)'/g)].map(m => m[1]);
  const all    = [];
  for (const range of ranges) {
    const b2 = new URLSearchParams({ _token: token, start: today, end: today, range }).toString();
    const r2 = await makeRequest("POST", "/portal/sms/received/getsms/number", b2,
      "application/x-www-form-urlencoded",
      { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
    ).catch(() => null);
    if (!r2) continue;
    const numbers = [...r2.body.matchAll(/toggleNum[^(]+\('(\d+)'/g)].map(m => m[1]);
    for (const number of numbers) {
      const b3 = new URLSearchParams({ _token: token, start: today, end: today, Number: number, Range: range }).toString();
      const r3 = await makeRequest("POST", "/portal/sms/received/getsms/number/sms", b3,
        "application/x-www-form-urlencoded",
        { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
      ).catch(() => null);
      if (!r3) continue;
      all.push(...parseSMSMessages(r3.body, range, number, today));
    }
  }
  return all;
}

/* ================= TELEGRAM API ================= */
function telegramRequest(method, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req  = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${BOT_TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
function sendMsg(chatId, text, extra = {}) {
  return telegramRequest("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

/* ================= HANDLE COMMAND ================= */
async function handleMessage(msg) {
  if (!msg || !msg.text) return;
  const userId  = msg.from.id;
  const chatId  = msg.chat.id;
  const text    = msg.text.trim();
  const isAdmin = ADMIN_IDS.includes(userId);

  // /start
  if (text === "/start") {
    await sendMsg(chatId,
      `👋 <b>IVAS SMS Bot</b>\n\n` +
      (isAdmin
        ? `Halo Admin! Command:\n/setcookie — Update cookie IVAS\n/status — Cek session\n/ceksms — Cek SMS sekarang`
        : `Bot notif SMS aktif.\n\n❌ Kamu tidak punya akses admin.`)
    );
    return;
  }

  if (!isAdmin) {
    await sendMsg(chatId, "❌ Kamu bukan admin.");
    return;
  }

  // /status
  if (text === "/status") {
    try {
      const token = await fetchToken();
      await sendMsg(chatId, token
        ? `✅ <b>Session aktif</b> — Cookie valid.`
        : `❌ <b>Session expired</b> — Gunakan /setcookie`
      );
    } catch {
      await sendMsg(chatId, `❌ Session expired. Gunakan /setcookie`);
    }
    return;
  }

  // /ceksms — manual trigger
  if (text === "/ceksms") {
    await sendMsg(chatId, "🔍 Mengambil SMS...");
    try {
      const msgs = await fetchAllSMS();
      if (msgs.length === 0) {
        await sendMsg(chatId, "📭 Tidak ada SMS hari ini.");
      } else {
        await sendMsg(chatId, `📬 <b>${msgs.length}</b> SMS ditemukan hari ini:`);
        for (const m of msgs.slice(0, 10)) await sendMsg(chatId, formatNotif(m));
        if (msgs.length > 10) await sendMsg(chatId, `...dan ${msgs.length - 10} SMS lainnya.`);
      }
    } catch (e) {
      await sendMsg(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  // /setcookie — mulai flow update cookie
  if (text === "/setcookie") {
    userState[userId] = { step: "waiting_cookie" };
    await sendMsg(chatId,
      `🍪 <b>Update Cookie IVAS</b>\n\n` +
      `Buka browser → login IVAS → DevTools (F12) → Network → klik request apapun → Request Headers → salin isi <b>Cookie</b>\n\n` +
      `Lalu kirim ke sini. Format:\n` +
      `<code>XSRF-TOKEN=xxx; ivas_sms_session=yyy</code>\n\n` +
      `(Boleh paste semua cookie, bot akan extract otomatis)\n\n` +
      `/batal untuk membatalkan.`
    );
    return;
  }

  // /batal
  if (text === "/batal") {
    delete userState[userId];
    await sendMsg(chatId, "❌ Dibatalkan.");
    return;
  }

  // Proses cookie yang dikirim admin
  if (userState[userId]?.step === "waiting_cookie") {
    delete userState[userId];
    const parsed = parseCookieString(text);

    if (!parsed["XSRF-TOKEN"] || !parsed["ivas_sms_session"]) {
      await sendMsg(chatId,
        `❌ <b>Tidak ditemukan cookie yang dibutuhkan!</b>\n\n` +
        `Pastikan ada <code>XSRF-TOKEN</code> dan <code>ivas_sms_session</code>.\n\n` +
        `Coba lagi: /setcookie`
      );
      return;
    }

    COOKIES["XSRF-TOKEN"]       = parsed["XSRF-TOKEN"];
    COOKIES["ivas_sms_session"] = parsed["ivas_sms_session"];
    console.log(`✅ [BOT] Cookie diupdate via Telegram (admin: ${userId})`);

    // Verifikasi langsung
    try {
      const token = await fetchToken();
      await sendMsg(chatId, token
        ? `✅ <b>Cookie berhasil diupdate!</b>\nSession valid dan aktif. Bot siap kirim notif.`
        : `⚠️ Cookie disimpan, tapi session tampaknya expired. Coba cookie yang lebih baru.`
      );
    } catch {
      await sendMsg(chatId, "⚠️ Cookie disimpan, gagal verifikasi. Mungkin sudah expired.");
    }
    return;
  }

  // Default
  await sendMsg(chatId,
    `❓ Tidak dikenal.\n\nCommand:\n/setcookie\n/status\n/ceksms`
  );
}

/* ================= NOTIF SMS ================= */
const seenMessages = new Set();
function makeKey(m) { return `${m.datetime}|${m.number}|${m.message}`; }
function formatNotif(msg) {
  const otpMatch = msg.message.match(/\b(\d{4,8})\b/);
  const otp      = otpMatch ? `\n🔑 <b>Kode: ${otpMatch[1]}</b>` : "";
  return (
    `📩 <b>SMS Masuk</b>\n` +
    `📞 Nomor: <code>${msg.number}</code>\n` +
    `👤 Dari: ${msg.sender}\n` +
    `🗂 Range: ${msg.range}\n` +
    `🕐 Waktu: ${msg.datetime}\n` +
    `💬 Pesan: ${msg.message}` + otp
  );
}

async function pollSMS() {
  console.log(`🔍 [BOT] Cek SMS... (${new Date().toLocaleTimeString()})`);
  try {
    const messages = await fetchAllSMS();
    let newCount = 0;
    for (const msg of messages) {
      const key = makeKey(msg);
      if (!seenMessages.has(key)) {
        seenMessages.add(key);
        await sendMsg(CHAT_ID, formatNotif(msg));
        newCount++;
      }
    }
    if (newCount > 0) console.log(`✅ [BOT] ${newCount} SMS baru`);
    else console.log(`ℹ️  [BOT] Tidak ada SMS baru (total: ${messages.length})`);
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") {
      console.error("❌ [BOT] Session expired!");
      await sendMsg(CHAT_ID,
        `⚠️ <b>Session IVAS expired!</b>\n\nAdmin, kirim /setcookie untuk update cookie.`
      );
    } else {
      console.error("❌ [BOT] Error:", err.message);
    }
  }
}

/* ================= LONG POLLING TELEGRAM ================= */
let lastUpdateId = 0;
async function updateLoop() {
  while (true) {
    try {
      const res = await telegramRequest("getUpdates", {
        offset:          lastUpdateId + 1,
        timeout:         20,
        allowed_updates: ["message"]
      });
      if (res.ok && res.result) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          handleMessage(update.message).catch(e =>
            console.error("[BOT] handleMessage error:", e.message)
          );
        }
      }
    } catch (e) {
      console.error("[BOT] getUpdates error:", e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

/* ================= START ================= */
console.log(`🤖 [BOT] Aktif — SMS poll tiap ${POLL_INTERVAL_MS/1000}s`);
console.log(`👮 Admin IDs: ${ADMIN_IDS.join(", ")}`);
updateLoop();
pollSMS();
setInterval(pollSMS, POLL_INTERVAL_MS);
