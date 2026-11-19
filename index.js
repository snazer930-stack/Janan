// Node.js 18+ | discord.js v14 | file: index.js

const { Client, GatewayIntentBits, ChannelType } = require("discord.js");

const BOT_TOKEN = process.env.BOT_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`[olliE] ${client.user.tag} — ready.`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.member?.permissions.has("Administrator")) return;

  if (msg.content !== "!build") return;

  const guild = msg.guild;
  await msg.reply("Construction en cours...");

  const structure = [
    {
      category: "IMPORTANT",
      channels: [
        "annonces",
        "maj",
        "concours",
        "partenariats",
        "nos-adds",
        "keydrop",
        "vitrine",
        "clowns",
        "sources",
      ],
    },
    {
      category: "NOS SCRIPTS",
      channels: [
        "achat",
        "tarifs",
        "duel",
        "lagger",
        "speed-bypass",
        "scripts-gratuits",
      ],
    },
    {
      category: "COMMUNAUTÉ",
      channels: [
        "discussion",
        "echange",
        "avis",
        "key-bypass",
      ],
    },
    {
      category: "STEAL",
      channels: [
        "meilleurs-steals",
        "steal",
      ],
    },
  ];

  for (const block of structure) {
    let cat;
    try {
      cat = await guild.channels.create({
        name: block.category,
        type: ChannelType.GuildCategory,
        reason: "!build",
      });
      await sleep(500);
    } catch (e) {
      console.error(`[err] cat ${block.category}: ${e.message}`);
      continue;
    }

    for (const chName of block.channels) {
      try {
        await guild.channels.create({
          name: chName,
          type: ChannelType.GuildText,
          parent: cat.id,
          reason: "!build",
        });
        await sleep(500);
      } catch (e) {
        console.error(`[err] ch ${chName}: ${e.message}`);
      }
    }
  }

  await msg.reply("Done. Structure complète. ez.");
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

client.login(BOT_TOKEN);
