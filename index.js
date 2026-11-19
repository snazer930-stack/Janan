// Node.js 24 — discord.js v14
// env: BOT_TOKEN, CLIENT_ID

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
  ButtonStyle
} = require("discord.js");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

let autoRoleId = null;
let welcomeChannelId = null;

// ====================== READY ======================
client.once("ready", async () => {
  console.log(`[olliE] ${client.user.tag} — ready.`);

  const commands = [
    new SlashCommandBuilder().setName("build").setDescription("Formulaire pour construire le serveur"),
    new SlashCommandBuilder().setName("autorole").setDescription("Définir le rôle automatique")
      .addRoleOption(o => o.setName("role").setDescription("Rôle à donner").setRequired(true)),
    new SlashCommandBuilder().setName("setwelcome").setDescription("Définir le salon de bienvenue")
      .addChannelOption(o => o.setName("salon").setDescription("Salon de bienvenue").setRequired(true)),
    new SlashCommandBuilder().setName("giveaway").setDescription("Lancer un giveaway")
      .addStringOption(o => o.setName("durée").setDescription("Ex: 10m, 1h, 1d").setRequired(true))
      .addIntegerOption(o => o.setName("gagnants").setDescription("Nombre de gagnants").setRequired(true))
      .addStringOption(o => o.setName("prix").setDescription("Ce qu'on gagne").setRequired(true)),
    new SlashCommandBuilder().setName("clear").setDescription("Supprimer des messages")
      .addIntegerOption(o => o.setName("nombre").setDescription("1-100").setRequired(true)),
    new SlashCommandBuilder().setName("ban").setDescription("Bannir un membre")
      .addUserOption(o => o.setName("membre").setRequired(true))
      .addStringOption(o => o.setName("raison")),
    new SlashCommandBuilder().setName("kick").setDescription("Expulser un membre")
      .addUserOption(o => o.setName("membre").setRequired(true))
      .addStringOption(o => o.setName("raison")),
    new SlashCommandBuilder().setName("lock").setDescription("Verrouiller le salon"),
    new SlashCommandBuilder().setName("unlock").setDescription("Déverrouiller le salon"),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Toutes les commandes enregistrées");
  } catch (e) {
    console.error(e);
  }
});

// ====================== BIENVENUE ======================
client.on("guildMemberAdd", async (member) => {
  if (autoRoleId) {
    try { await member.roles.add(autoRoleId); } catch (e) {}
  }

  if (!welcomeChannelId) return;
  const channel = member.guild.channels.cache.get(welcomeChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle(`Bienvenue ${member.user.username} !`)
    .setDescription(`Bienvenue sur **${member.guild.name}** !\nTu es le **${member.guild.memberCount}ème** membre.`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: "Profite bien du serveur" })
    .setTimestamp();

  try {
    await channel.send({ content: `Bienvenue <@${member.id}> !`, embeds: [embed] });
  } catch (e) {
    console.error("Erreur welcome:", e.message);
  }
});

// ====================== INTERACTIONS ======================
client.on("interactionCreate", async (interaction) => {

  // ---------- /build ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "build") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "Réservé aux Administrateurs.", ephemeral: true });

    const modal = new ModalBuilder().setCustomId("buildModal").setTitle("Construction du serveur");

    const rolesInput = new TextInputBuilder()
      .setCustomId("roles")
      .setLabel("Rôles (un par ligne)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Client\nStaff\nModérateur\nVIP")
      .setRequired(false);

    const structureInput = new TextInputBuilder()
      .setCustomId("structure")
      .setLabel("Structure (catégorie en MAJUSCULES)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("IMPORTANT\nannonces\nmaj\nVocal Général (vocal)\n\nNOS SCRIPTS\nachat\ntarifs")
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(rolesInput),
      new ActionRowBuilder().addComponents(structureInput)
    );

    return interaction.showModal(modal);
  }

  // ---------- TRAITEMENT FORMULAIRE ----------
  if (interaction.isModalSubmit() && interaction.customId === "buildModal") {
    await interaction.deferReply({ ephemeral: true });

    const rolesText = interaction.fields.getTextInputValue("roles") || "";
    const structureText = interaction.fields.getTextInputValue("structure");
    const guild = interaction.guild;

    const roleNames = rolesText.split("\n").map(r => r.trim()).filter(r => r.length > 0);
    for (const name of roleNames) {
      try {
        await guild.roles.create({ name, reason: `Build par ${interaction.user.tag}` });
        await sleep(800);
      } catch (e) {}
    }

    const lines = structureText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const structure = [];
    let current = null;

    for (const line of lines) {
      if (line === line.toUpperCase() && line.length > 1) {
        current = { category: line, channels: [] };
        structure.push(current);
      } else if (current) {
        current.channels.push(line);
      }
    }

    for (const block of structure) {
      let cat;
      try {
        cat = await guild.channels.create({
          name: block.category,
          type: ChannelType.GuildCategory,
          reason: `Build par ${interaction.user.tag}`,
        });
        await sleep(1100);
      } catch (e) { continue; }

      for (const ch of block.channels) {
        const isVoice = ch.toLowerCase().includes("(vocal)") || ch.toLowerCase().includes("(voice)");
        const name = ch.replace(/\(vocal\)|\(voice\)/gi, "").trim().toLowerCase().replace(/\s+/g, "-");
        try {
          await guild.channels.create({
            name,
            type: isVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
            parent: cat.id,
            reason: `Build par ${interaction.user.tag}`,
          });
          await sleep(1100);
        } catch (e) {}
      }
    }

    return interaction.editReply(`Serveur construit.\n• ${roleNames.length} rôles\n• ${structure.length} catégories`);
  }

  // ---------- SETWELCOME ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "setwelcome") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "Réservé aux Administrateurs.", ephemeral: true });
    welcomeChannelId = interaction.options.getChannel("salon").id;
    return interaction.reply(`Salon de bienvenue défini : ${interaction.options.getChannel("salon")}`);
  }

  // ---------- AUTOROLE ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "autorole") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "Réservé aux Administrateurs.", ephemeral: true });
    autoRoleId = interaction.options.getRole("role").id;
    return interaction.reply(`Auto-role défini : **${interaction.options.getRole("role").name}**`);
  }

  // ---------- GIVEAWAY ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "giveaway") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ content: "Permission insuffisante.", ephemeral: true });

    const durée = interaction.options.getString("durée");
    const gagnants = interaction.options.getInteger("gagnants");
    const prix = interaction.options.getString("prix");

    const ms = parseDuration(durée);
    if (!ms) return interaction.reply({ content: "Durée invalide (ex: 10m, 1h, 1d)", ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle("🎉 GIVEAWAY")
      .setDescription(`**Prix :** ${prix}\n**Gagnants :** ${gagnants}\n**Fini <t:${Math.floor((Date.now() + ms) / 1000)}:R>**`)
      .setColor("#5865F2");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("giveaway_join").setLabel("Participer").setStyle(ButtonStyle.Primary).setEmoji("🎉")
    );

    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    const participants = new Set();
    const collector = msg.createMessageComponentCollector({ time: ms });

    collector.on("collect", i => {
      if (i.customId === "giveaway_join") {
        participants.add(i.user.id);
        i.reply({ content: "Tu participes !", ephemeral: true });
      }
    });

    collector.on("end", async () => {
      const winners = [...participants].sort(() => 0.5 - Math.random()).slice(0, gagnants);
      const winText = winners.length > 0 ? winners.map(id => `<@${id}>`).join(", ") : "Personne";
      const endEmbed = EmbedBuilder.from(embed)
        .setDescription(`**Prix :** ${prix}\n**Gagnants :** ${winText}\n**Terminé**`)
        .setColor("#57F287");
      await msg.edit({ embeds: [endEmbed], components: [] });
    });
  }

  // ---------- CLEAR ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "clear") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages))
      return interaction.reply({ content: "Permission insuffisante.", ephemeral: true });
    const nombre = interaction.options.getInteger("nombre");
    if (nombre < 1 || nombre > 100) return interaction.reply({ content: "Entre 1 et 100.", ephemeral: true });
    await interaction.channel.bulkDelete(nombre, true);
    return interaction.reply({ content: `**${nombre}** messages supprimés.`, ephemeral: true });
  }

  // ---------- BAN ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "ban") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers))
      return interaction.reply({ content: "Permission insuffisante.", ephemeral: true });
    const user = interaction.options.getUser("membre");
    const raison = interaction.options.getString("raison") || "Aucune raison";
    await interaction.guild.members.ban(user, { reason: raison });
    return interaction.reply(`**${user.tag}** a été banni.`);
  }

  // ---------- KICK ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "kick") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.KickMembers))
      return interaction.reply({ content: "Permission insuffisante.", ephemeral: true });
    const user = interaction.options.getUser("membre");
    const raison = interaction.options.getString("raison") || "Aucune raison";
    await interaction.guild.members.kick(user, raison);
    return interaction.reply(`**${user.tag}** a été expulsé.`);
  }

  // ---------- LOCK / UNLOCK ----------
  if (interaction.isChatInputCommand() && (interaction.commandName === "lock" || interaction.commandName === "unlock")) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels))
      return interaction.reply({ content: "Permission insuffisante.", ephemeral: true });
    const lock = interaction.commandName === "lock";
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: lock ? false : null,
    });
    return interaction.reply(lock ? "Salon verrouillé." : "Salon déverrouillé.");
  }
});

// ====================== UTILS ======================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60 * 1000;
  if (unit === "h") return num * 60 * 60 * 1000;
  if (unit === "d") return num * 24 * 60 * 60 * 1000;
  return null;
}

client.login(BOT_TOKEN);
