// Node.js 24 — discord.js v14 + Gemini 2.0 Flash Lite (GRATUIT)
// env: BOT_TOKEN, CLIENT_ID, GEMINI_KEY
// run: node bot.js

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  Routes,
  REST,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

// ─── env ───────────────────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN;
const CLIENT_ID  = process.env.CLIENT_ID;
const GEMINI_KEY = process.env.GEMINI_KEY;

for (const [k, v] of Object.entries({ BOT_TOKEN, CLIENT_ID, GEMINI_KEY })) {
  if (!v) { console.error(`[olliE] missing env: ${k}`); process.exit(1); }
}

// ─── state ────────────────────────────────────────────────────────────────────
const guildConfig     = new Map();
const activeGiveaways = new Map();

function cfg(guildId) {
  if (!guildConfig.has(guildId)) guildConfig.set(guildId, {});
  return guildConfig.get(guildId);
}

// ─── sanitize ─────────────────────────────────────────────────────────────────
function sanitizeName(str, max = 100) {
  return (str ?? "")
    .trim()
    .replace(/[^\w\s\-\u00C0-\u024F]/g, "")
    .trim()
    .slice(0, max) || "unnamed";
}

function sanitizeChannelName(str) {
  return (str ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 100) || "general";
}

// ─── client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Gemini ────────────────────────────────────────────────────────────────────
async function generateServerStructure(description, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_KEY}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a Discord server architect. Generate a compact server structure.

Description: ${description}

Rules:
- Maximum 5 roles
- Maximum 4 categories
- Maximum 4 channels per category
- Channel names: lowercase, no spaces, no special chars, ASCII only

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "roles": ["RoleName1", "RoleName2"],
  "categories": [
    {
      "name": "CATEGORY NAME",
      "channels": [
        { "name": "channel-name", "type": "text" },
        { "name": "Voice Channel", "type": "voice" }
      ]
    }
  ]
}`,
          }],
        }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    });
  } catch (e) {
    throw new Error(`Fetch réseau échoué : ${e.message}`);
  }

  if (res.status === 503 && attempt < 3) {
    console.warn(`[olliE] Gemini 503 — tentative ${attempt}/3, retry dans ${attempt * 3}s`);
    await sleep(attempt * 3000);
    return generateServerStructure(description, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status} : ${body}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`Réponse Gemini non-JSON : ${e.message}`);
  }

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!raw) throw new Error("Gemini a renvoyé une réponse vide");

  const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error(`JSON invalide de Gemini : ${clean.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.roles) || !Array.isArray(parsed.categories))
    throw new Error(`Structure manquante — reçu : ${JSON.stringify(parsed).slice(0, 200)}`);

  return parsed;
}

// ─── slash commands ────────────────────────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder()
    .setName("build")
    .setDescription("Décris ton serveur, l'IA le construit")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("clearchannels")
    .setDescription("Supprimer tous les salons du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Définir le rôle automatique")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName("role").setDescription("Rôle à donner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Définir le salon de bienvenue")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("salon").setDescription("Salon de bienvenue").setRequired(true)),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Lancer un giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("durée").setDescription("Durée ex: 10m 1h 1d").setRequired(true))
    .addIntegerOption(o => o.setName("gagnants").setDescription("Nombre de gagnants").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("prix").setDescription("Ce qu'on gagne").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprimer des messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("nombre").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannir un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("membre").setDescription("Membre à bannir").setRequired(true))
    .addStringOption(o => o.setName("raison").setDescription("Raison du ban")),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulser un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("membre").setDescription("Membre à expulser").setRequired(true))
    .addStringOption(o => o.setName("raison").setDescription("Raison du kick")),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Verrouiller le salon actuel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Déverrouiller le salon actuel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map(c => c.toJSON());

// ─── ready ─────────────────────────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`[olliE] ${client.user.tag} — ready.`);
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: COMMANDS });
    console.log("[olliE] slash commands registered.");
  } catch (e) {
    console.error("[olliE] command registration failed:", e);
  }
});

// ─── welcome + autorole ────────────────────────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  const { autoRoleId, welcomeChannelId } = cfg(member.guild.id);

  if (autoRoleId) {
    try { await member.roles.add(autoRoleId); }
    catch (e) { console.warn("[olliE] autorole failed:", e.message); }
  }

  if (!welcomeChannelId) return;
  const channel = member.guild.channels.cache.get(welcomeChannelId);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle(`Bienvenue ${member.user.username} !`)
    .setDescription(
      `Bienvenue sur **${member.guild.name}** !\nTu es le **${member.guild.memberCount}ème** membre.`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: "Profite bien du serveur" })
    .setTimestamp();

  try { await channel.send({ content: `Bienvenue <@${member.id}> !`, embeds: [embed] }); }
  catch (e) { console.warn("[olliE] welcome send failed:", e.message); }
});

// ─── interaction router ────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isModalSubmit())      return await handleModal(interaction);
    if (interaction.isButton())           return await handleButton(interaction);
  } catch (e) {
    console.error("[olliE] interaction error:", e.message, e.stack);
    const reply = { content: `❌ Erreur : ${e.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied)
      interaction.editReply(reply).catch(() => {});
    else
      interaction.reply(reply).catch(() => {});
  }
});

// ─── command handler ───────────────────────────────────────────────────────────
async function handleCommand(interaction) {
  const { commandName, guild } = interaction;

  if (commandName === "build") {
    const modal = new ModalBuilder()
      .setCustomId("buildModal")
      .setTitle("Décris ton serveur");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Décris ton serveur en quelques phrases")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Ex: serveur FiveM avec staff, boutique et support.")
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (commandName === "clearchannels") {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("clearchannels_confirm")
        .setLabel("⚠️ Confirmer la suppression")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("clearchannels_cancel")
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
      content: "⚠️ **Tu vas supprimer TOUS les salons du serveur.** Tu es sûr ?",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === "autorole") {
    const role = interaction.options.getRole("role");
    cfg(guild.id).autoRoleId = role.id;
    return interaction.reply(`✅ Auto-role défini : **${role.name}**`);
  }

  if (commandName === "setwelcome") {
    const salon = interaction.options.getChannel("salon");
    cfg(guild.id).welcomeChannelId = salon.id;
    return interaction.reply(`✅ Salon de bienvenue défini : ${salon}`);
  }

  if (commandName === "giveaway") {
    const durée    = interaction.options.getString("durée");
    const gagnants = interaction.options.getInteger("gagnants");
    const prix     = interaction.options.getString("prix");
    const ms       = parseDuration(durée);
    if (!ms) return interaction.reply({ content: "❌ Durée invalide. Exemples : 30s 10m 2h 1d", flags: MessageFlags.Ephemeral });

    const endsAt = Math.floor((Date.now() + ms) / 1000);
    const embed = new EmbedBuilder()
      .setTitle("🎉 GIVEAWAY")
      .setDescription(`**Prix :** ${prix}\n**Gagnants :** ${gagnants}\n**Fin :** <t:${endsAt}:R>`)
      .setColor("#5865F2");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("giveaway_join")
        .setLabel("Participer")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎉")
    );

    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    activeGiveaways.set(msg.id, new Set());

    setTimeout(async () => {
      const participants = activeGiveaways.get(msg.id) ?? new Set();
      activeGiveaways.delete(msg.id);
      const pool    = [...participants];
      const winners = pool.sort(() => 0.5 - Math.random()).slice(0, gagnants);
      const winText = winners.length > 0 ? winners.map(id => `<@${id}>`).join(", ") : "Personne";
      const endEmbed = EmbedBuilder.from(embed)
        .setDescription(`**Prix :** ${prix}\n**Gagnants :** ${winText}\n**Terminé**`)
        .setColor("#57F287");
      await msg.edit({ embeds: [endEmbed], components: [] }).catch(() => {});
      if (winners.length > 0)
        await interaction.channel
          .send(`🎉 Félicitations ${winText} ! Vous avez gagné **${prix}** !`)
          .catch(() => {});
    }, ms);
    return;
  }

  if (commandName === "clear") {
    const nombre  = interaction.options.getInteger("nombre");
    const deleted = await interaction.channel.bulkDelete(nombre, true);
    return interaction.reply({ content: `✅ **${deleted.size}** messages supprimés.`, flags: MessageFlags.Ephemeral });
  }

  if (commandName === "ban") {
    const user   = interaction.options.getUser("membre");
    const raison = interaction.options.getString("raison") ?? "Aucune raison fournie";
    try {
      await interaction.guild.members.ban(user, { reason: raison });
      return interaction.reply(`✅ **${user.tag}** banni. Raison : ${raison}`);
    } catch (e) {
      return interaction.reply({ content: `❌ Impossible de bannir : ${e.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  if (commandName === "kick") {
    const user   = interaction.options.getUser("membre");
    const raison = interaction.options.getString("raison") ?? "Aucune raison fournie";
    try {
      await interaction.guild.members.kick(user, raison);
      return interaction.reply(`✅ **${user.tag}** expulsé. Raison : ${raison}`);
    } catch (e) {
      return interaction.reply({ content: `❌ Impossible d'expulser : ${e.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  if (commandName === "lock" || commandName === "unlock") {
    const lock = commandName === "lock";
    try {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: lock ? false : null }
      );
      return interaction.reply(lock ? "🔒 Salon verrouillé." : "🔓 Salon déverrouillé.");
    } catch (e) {
      return interaction.reply({ content: `❌ Échec : ${e.message}`, flags: MessageFlags.Ephemeral });
    }
  }
}

// ─── modal handler ─────────────────────────────────────────────────────────────
async function handleModal(interaction) {
  if (interaction.customId !== "buildModal") return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    console.error("[olliE] deferReply failed:", e.message);
    return;
  }

  const description = interaction.fields.getTextInputValue("description");
  const guild       = interaction.guild;

  let structure;
  try {
    structure = await generateServerStructure(description);
    console.log("[olliE] Gemini ok:", JSON.stringify(structure).slice(0, 300));
  } catch (e) {
    console.error("[olliE] AI error:", e.message);
    return interaction.editReply(`❌ Erreur IA : ${e.message}`);
  }

  const roles      = structure.roles ?? [];
  const categories = structure.categories ?? [];
  let   chanCount  = 0;

  for (const name of roles) {
    const clean = sanitizeName(name);
    try { await guild.roles.create({ name: clean, reason: "AI Build" }); }
    catch (e) { console.warn(`[olliE] role "${clean}":`, e.message); }
    await sleep(800);
  }

  for (const block of categories) {
    const catName = sanitizeName(block.name);
    let cat;
    try {
      cat = await guild.channels.create({
        name: catName,
        type: ChannelType.GuildCategory,
        reason: "AI Build",
      });
    } catch (e) {
      console.warn(`[olliE] category "${catName}":`, e.message);
      continue;
    }
    await sleep(1100);

    for (const ch of (block.channels ?? [])) {
      const chName = ch.type === "voice"
        ? sanitizeName(ch.name)
        : sanitizeChannelName(ch.name);
      try {
        await guild.channels.create({
          name: chName,
          type: ch.type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText,
          parent: cat.id,
          reason: "AI Build",
        });
        chanCount++;
      } catch (e) {
        console.warn(`[olliE] channel "${chName}":`, e.message);
      }
      await sleep(1100);
    }
  }

  return interaction.editReply(
    `✅ Serveur construit !\n• **${roles.length}** rôles\n• **${categories.length}** catégories\n• **${chanCount}** salons`
  );
}

// ─── button handler ────────────────────────────────────────────────────────────
async function handleButton(interaction) {

  if (interaction.customId === "clearchannels_cancel") {
    return interaction.update({ content: "❌ Annulé.", components: [] });
  }

  if (interaction.customId === "clearchannels_confirm") {
    await interaction.update({ content: "🗑️ Suppression en cours...", components: [] });
    const guild    = interaction.guild;
    const channels = [...guild.channels.cache.values()];
    let   deleted  = 0;
    for (const ch of channels) {
      try { await ch.delete("clearchannels"); deleted++; }
      catch (e) { console.warn(`[olliE] delete "${ch.name}":`, e.message); }
      await sleep(600);
    }
    console.log(`[olliE] clearchannels: ${deleted}/${channels.length} salons supprimés.`);
    return;
  }

  if (interaction.customId === "giveaway_join") {
    const participants = activeGiveaways.get(interaction.message.id);
    if (!participants)
      return interaction.reply({ content: "❌ Ce giveaway est terminé.", flags: MessageFlags.Ephemeral });
    if (participants.has(interaction.user.id))
      return interaction.reply({ content: "Tu participes déjà !", flags: MessageFlags.Ephemeral });
    participants.add(interaction.user.id);
    return interaction.reply({ content: "✅ Tu participes !", flags: MessageFlags.Ephemeral });
  }
}

// ─── utils ─────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseDuration(str) {
  const match = str.trim().match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const u = match[2].toLowerCase();
  return { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[u] * n;
}

client.login(BOT_TOKEN);
