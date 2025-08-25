const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const _rawBotToken = process.env.BOT_TOKEN;
const BOT_TOKEN = _rawBotToken
  ? _rawBotToken
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^'|'$/g, "")
      .replace(/^Bot\s+/i, "")
  : undefined;
const CLIENT_ID = process.env.CLIENT_ID
  ? process.env.CLIENT_ID.trim()
  : undefined;
const GUILD_ID = process.env.GUILD_ID ? process.env.GUILD_ID.trim() : undefined;

const DATA_FILE = path.join(__dirname, "campaigns.json");

class VireoCampaignBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.campaigns = this.loadCampaigns();
    this.setupEventHandlers();
  }

  loadCampaigns() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      }
    } catch (error) {
      console.error("Error loading campaigns:", error);
    }
    return {};
  }

  async saveCampaigns() {
    try {
      const tmp = `${DATA_FILE}.tmp`;
      await fs.promises.writeFile(
        tmp,
        JSON.stringify(this.campaigns, null, 2),
        "utf8"
      );
      await fs.promises.rename(tmp, DATA_FILE);
    } catch (error) {
      console.error("Error saving campaigns:", error);
    }
  }

  async ensureCategory(guild, categoryName) {
    try {
      let category = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === categoryName
      );

      if (!category) {
        const fetched = await guild.channels.fetch().catch(() => null);
        if (fetched) {
          category = fetched.find(
            (c) =>
              c.type === ChannelType.GuildCategory && c.name === categoryName
          );
        }
      }

      if (category) {
        try {
          await category.permissionOverwrites.edit(this.client.user.id, {
            ViewChannel: true,
            ManageChannels: true,
            ManageRoles: true,
          });
        } catch (permErr) {
          console.warn(
            "Could not edit permissions on existing category:",
            permErr
          );
        }
        return category;
      }

      const newCategory = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: this.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles,
            ],
          },
        ],
      });

      return newCategory;
    } catch (err) {
      console.error("ensureCategory error:", err);
      return null;
    }
  }

  setupEventHandlers() {
    this._readyHandled = false;
    const onReady = () => {
      if (this._readyHandled) return;
      this._readyHandled = true;
      console.log(
        `🚀 Vireo Campaign Bot is ready! Logged in as ${this.client.user.tag}`
      );
      try {
        this.client.user.setActivity("Managing Campaigns", { type: 3 });
      } catch (e) {}
    };

    this.client.once("ready", onReady);
    this.client.once("clientReady", onReady);

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isModalSubmit && interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      } else if (interaction.isButton()) {
        await this.handleButton(interaction);
      }
    });
  }

  async handleSlashCommand(interaction) {
    const { commandName } = interaction;

    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "❌ You need administrator permissions to use this command.",
        flags: 64,
      });
    }

    switch (commandName) {
      case "create-campaign":
        const modal = new ModalBuilder()
          .setCustomId("createCampaignModal")
          .setTitle("Create Campaign");

        const titleInput = new TextInputBuilder()
          .setCustomId("campaignTitle")
          .setLabel("Campaign Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100);

        const descInput = new TextInputBuilder()
          .setCustomId("campaignDescription")
          .setLabel("Campaign Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput)
        );

        await interaction.showModal(modal);
        break;
      case "close-campaign":
        await this.closeCampaign(interaction);
        break;
      case "campaign-stats":
        await this.showCampaignStats(interaction);
        break;
      case "list-campaigns":
        await this.listCampaigns(interaction);
        break;
      case "bot-audit":
        await this.handleBotAudit(interaction);
        break;
    }
  }

  async handleBotAudit(interaction) {
    try {
      if (!interaction.inGuild() || !interaction.member) {
        return interaction.reply({
          content: "This command must be used in a guild by an administrator.",
          flags: 64,
        });
      }

      const guild = interaction.guild;
      const me = guild?.members?.me;
      if (!me) {
        return interaction.reply({
          content: "Could not determine bot member.",
          flags: 64,
        });
      }

      const needed = [
        "ManageRoles",
        "ManageChannels",
        "SendMessages",
        "EmbedLinks",
        "ReadMessageHistory",
        "ViewChannel",
      ];

      const has = [];
      const missing = [];

      const perms = me.permissions;
      needed.forEach((p) => {
        if (perms.has(PermissionFlagsBits[p])) has.push(p);
        else missing.push(p);
      });

      const reply = `**Bot audit for ${guild.name}**\n\nBot role position: ${
        me.roles.highest.position
      }\nHas permissions: ${has.join(", ") || "None"}\nMissing permissions: ${
        missing.join(", ") || "None"
      }`;

      await interaction.reply({ content: reply, flags: 64 });
    } catch (err) {
      console.error("handleBotAudit error:", err);
      await interaction.reply({
        content: "Error running bot audit.",
        flags: 64,
      });
    }
  }

  async handleModalSubmit(interaction) {
    if (interaction.customId === "createCampaignModal") {
      const title = interaction.fields.getTextInputValue("campaignTitle");
      const description = interaction.fields.getTextInputValue(
        "campaignDescription"
      );

      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        try {
          await interaction.reply({
            content: "Creating campaign...",
            flags: 64,
          });
        } catch (err) {
          console.error("Failed to acknowledge modal submit:", err);
        }
      }

      try {
        await this.processCreateCampaign(interaction, { title, description });
        await interaction.editReply({
          content: `✅ Campaign **${title}** created.`,
        });
      } catch (err) {
        console.error("Error processing campaign from modal:", err);
        try {
          await interaction.editReply({
            content:
              "⚠️ Something went wrong while creating the campaign. Check bot permissions or run /bot-audit for details.",
          });
        } catch (e) {
          console.error("Failed to send error reply after modal failure:", e);
        }
      }
    }
  }

  async processCreateCampaign(interaction, { title, description }) {
    const logoUrl = "https://via.placeholder.com/64x64/4CAF50/FFFFFF?text=V";
    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("🎯 Vireo Opportunities")
      .setDescription(`**${title}**\n\n${description}`)
      .setFooter({ text: "Powered by Vireo", iconURL: logoUrl })
      .setThumbnail(logoUrl)
      .setTimestamp();

    const button = new ButtonBuilder()
      .setCustomId(`join_campaign_${Date.now()}`)
      .setLabel("Start Clipping")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🎬");

    const row = new ActionRowBuilder().addComponents(button);

    const channel = interaction.channel;
    let message;
    try {
      message = await channel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error("Failed to send campaign message:", err);
      try {
        await interaction.followUp({
          content:
            "⚠️ I couldn't post the campaign in this channel — I may be missing Send Messages or Embed Links permission here. Run /bot-audit for details.",
          flags: 64,
        });
      } catch (e) {}
      return;
    }

    const campaignId = button.data.custom_id.split("_")[2];
    this.campaigns[campaignId] = {
      id: campaignId,
      title,
      description,
      messageId: message.id,
      channelId: channel.id,
      participants: [],
      createdAt: new Date().toISOString(),
      active: true,
      hasPrivateChannels: false,
    };
    await this.saveCampaigns();

    const guild = channel.guild;
    if (
      this.botHasPermissions(
        guild,
        PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles
      )
    ) {
      try {
        const categoryName = `📊 ${title}`;
        let category = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === categoryName
        );

        if (!category) {
          category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              {
                id: guild.roles.everyone,
                deny: [PermissionFlagsBits.ViewChannel],
              },
              {
                id: this.client.user.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.ManageChannels,
                  PermissionFlagsBits.ManageRoles,
                ],
              },
            ],
          });
        } else {
          try {
            await category.permissionOverwrites.edit(this.client.user.id, {
              ViewChannel: true,
              ManageChannels: true,
              ManageRoles: true,
            });
          } catch (permErr) {
            console.warn(
              "Could not edit permissions on existing category:",
              permErr
            );
          }
        }

        this.campaigns[campaignId].categoryId = category.id;
        this.campaigns[campaignId].hasPrivateChannels = true;
        await this.saveCampaigns();
      } catch (err) {
        console.error(
          "Failed to create or find category in processCreateCampaign:",
          err
        );
      }
    }
  }

  async createCampaign(interaction) {
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const logoUrl =
      interaction.options.getString("logo") ||
      "https://via.placeholder.com/64x64/4CAF50/FFFFFF?text=V";

    let rulesSection = "";
    let payrateSection = "";

    const lines = description.split("\n").filter((line) => line.trim());
    let currentSection = "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (
        trimmedLine.toLowerCase().includes("rules:") ||
        trimmedLine.toLowerCase().includes("requirements:")
      ) {
        currentSection = "rules";
        continue;
      } else if (
        trimmedLine.toLowerCase().includes("payrate:") ||
        trimmedLine.toLowerCase().includes("payment:") ||
        trimmedLine.toLowerCase().includes("pay:")
      ) {
        currentSection = "payrate";
        continue;
      }

      if (currentSection === "rules" && trimmedLine) {
        const formattedLine =
          trimmedLine.startsWith("•") ||
          trimmedLine.startsWith("-") ||
          trimmedLine.startsWith("*")
            ? trimmedLine
            : `• ${trimmedLine}`;
        rulesSection += formattedLine + "\n";
      } else if (currentSection === "payrate" && trimmedLine) {
        const formattedLine =
          trimmedLine.startsWith("•") ||
          trimmedLine.startsWith("-") ||
          trimmedLine.startsWith("*")
            ? trimmedLine
            : `• ${trimmedLine}`;
        payrateSection += formattedLine + "\n";
      }
    }

    if (!rulesSection && !payrateSection) {
      const rulesMatch = description.match(
        /(?:rules?|requirements?):?\s*(.*?)(?=(?:payrate?|payment?|pay):?|$)/is
      );
      const payrateMatch = description.match(
        /(?:payrate?|payment?|pay):?\s*(.*?)$/is
      );

      rulesSection = rulesMatch
        ? rulesMatch[1]
            .trim()
            .split("\n")
            .map((line) =>
              line.trim() && !line.startsWith("•") && !line.startsWith("-")
                ? `• ${line.trim()}`
                : line.trim()
            )
            .filter(Boolean)
            .join("\n")
        : description;

      payrateSection = payrateMatch
        ? payrateMatch[1]
            .trim()
            .split("\n")
            .map((line) =>
              line.trim() && !line.startsWith("•") && !line.startsWith("-")
                ? `• ${line.trim()}`
                : line.trim()
            )
            .filter(Boolean)
            .join("\n")
        : "• Contact admin for details";
    }

    const embedColor = interaction.options.getString("embed-color") || "4CAF50";
    const embedTitle =
      interaction.options.getString("embed-title") || "🎯 Vireo Opportunities";
    const footerText =
      interaction.options.getString("footer-text") || "Powered by Vireo";

    const embed = new EmbedBuilder()
      .setColor(parseInt(embedColor, 16))
      .setTitle(embedTitle)
      .setDescription(`**${title}**`)
      .addFields(
        {
          name: "📋 Rules:",
          value: rulesSection || "• See campaign details",
          inline: false,
        },
        {
          name: "💰 Payrate:",
          value: payrateSection || "• Contact admin for details",
          inline: false,
        }
      )
      .setFooter({ text: footerText, iconURL: logoUrl })
      .setThumbnail(logoUrl)
      .setTimestamp();

    const buttonText =
      interaction.options.getString("button-text") || "Start Clipping";
    const buttonEmoji = interaction.options.getString("button-emoji") || "🎬";
    const buttonStyle =
      interaction.options.getString("button-style") || "Success";

    const buttonStyleMap = {
      Primary: ButtonStyle.Primary,
      Secondary: ButtonStyle.Secondary,
      Success: ButtonStyle.Success,
      Danger: ButtonStyle.Danger,
    };

    const button = new ButtonBuilder()
      .setCustomId(`join_campaign_${Date.now()}`)
      .setLabel(buttonText)
      .setStyle(buttonStyleMap[buttonStyle])
      .setEmoji(buttonEmoji);

    const row = new ActionRowBuilder().addComponents(button);

    try {
      const response = await interaction.reply({
        embeds: [embed],
        components: [row],
      });
      const message = await response.fetch();

      const campaignId = button.data.custom_id.split("_")[2];
      this.campaigns[campaignId] = {
        id: campaignId,
        title,
        description,
        messageId: message.id,
        channelId: interaction.channelId,
        participants: [],
        createdAt: new Date().toISOString(),
        active: true,
        rulesSection,
        payrateSection,
      };

      await this.saveCampaigns();

      const categoryName =
        interaction.options.getString("category-name") || `📊 ${title}`;
      const channelPrefix =
        interaction.options.getString("channel-prefix") || "workspace";

      const guild = interaction.guild;
      const category = await this.ensureCategory(guild, categoryName);

      if (category) this.campaigns[campaignId].categoryId = category.id;
      this.campaigns[campaignId].channelPrefix = channelPrefix;
      this.campaigns[campaignId].customization = {
        buttonText,
        buttonEmoji,
        buttonStyle,
        embedColor,
        embedTitle,
        footerText,
        categoryName,
      };
      await this.saveCampaigns();
    } catch (error) {
      console.error("Error creating campaign:", error);
      await interaction.editReply({
        content: "❌ Error creating campaign. Please try again.",
      });
    }
  }

  async handleButton(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith("join_campaign_")) {
      await this.joinCampaign(interaction);
    }
  }

  async joinCampaign(interaction) {
    const campaignId = interaction.customId.split("_")[2];
    const campaign = this.campaigns[campaignId];

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) {}

    const respond = async (opts) => {
      try {
        if (interaction.deferred || interaction.replied) {
          return await interaction.editReply(opts);
        }
        return await interaction.reply(opts);
      } catch (err) {
        console.error("Failed to respond to interaction:", err);
      }
    };

    if (!campaign || !campaign.active) {
      return respond({
        content: "❌ This campaign is no longer active.",
        flags: 64,
      });
    }

    const userId = interaction.user.id;

    if (campaign.participants.some((p) => p.userId === userId)) {
      return respond({
        content: "✅ You have already joined this campaign!",
        flags: 64,
      });
    }

    try {
      const guild = interaction.guild;
      const member = await guild.members.fetch(userId);

      let campaignRole = guild.roles.cache.find(
        (role) => role.name === `${campaign.title}`
      );
      if (!campaignRole) {
        campaignRole = await guild.roles.create({
          name: `${campaign.title}`,
          color: 0x4caf50,
          permissions: [],
        });
      }

      await member.roles.add(campaignRole);

      let category = null;
      if (campaign && campaign.categoryId) {
        try {
          category =
            guild.channels.cache.get(campaign.categoryId) ||
            (await guild.channels.fetch(campaign.categoryId).catch(() => null));
        } catch (e) {
          category = null;
        }
      }

      if (!category && campaign && campaign.title) {
        const expectedName = `📊 ${campaign.title}`;
        category = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === expectedName
        );
      }

      if (category) {
        try {
          await category.permissionOverwrites.edit(campaignRole, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
          });

          if (campaign && !campaign.categoryId) {
            campaign.categoryId = category.id;
            campaign.hasPrivateChannels = true;
            await this.saveCampaigns();
          }
        } catch (permErr) {
          console.error(
            "Failed to update category permission overwrites for role:",
            permErr
          );
        }
      } else {
        console.warn(
          `No category found for campaign ${
            campaign ? campaign.id : campaignId
          }. Role will still be created.`
        );
      }

      campaign.participants.push({
        userId,
        username: interaction.user.username,
        joinedAt: new Date().toISOString(),
        channelId: null,
        roleId: campaignRole.id,
      });

      await this.saveCampaigns();

      await this.logCampaignJoin(guild, campaign, interaction.user);

      await respond({
        content: `✅ Successfully joined **${campaign.title}**! Check your new private channel and role.`,
        flags: 64,
      });
    } catch (error) {
      console.error("Error joining campaign:", error);
      await respond({
        content: "❌ Error joining campaign. Please contact an administrator.",
        flags: 64,
      });
    }
  }

  async logCampaignJoin(guild, campaign, user) {
    const logChannel = guild.channels.cache.find(
      (ch) => ch.name.includes("log") || ch.name.includes("admin")
    );

    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x2196f3)
        .setTitle("📊 Campaign Join Log")
        .addFields(
          { name: "User", value: `${user} (${user.tag})`, inline: true },
          { name: "Campaign", value: campaign.title, inline: true },
          {
            name: "Total Participants",
            value: campaign.participants.length.toString(),
            inline: true,
          }
        )
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] });
    }
  }

  async closeCampaign(interaction) {
    const campaignId = interaction.options.getString("campaign-id");
    const campaign = this.campaigns[campaignId];

    if (!campaign) {
      return interaction.reply({
        content: "❌ Campaign not found.",
        flags: 64,
      });
    }

    try {
      campaign.active = false;
      campaign.closedAt = new Date().toISOString();

      const channel = await this.client.channels.fetch(campaign.channelId);
      const message = await channel.messages.fetch(campaign.messageId);

      const embed = EmbedBuilder.from(message.embeds[0])
        .setColor(0xff5722)
        .setTitle("🔒 Campaign Closed - Vireo Opportunities");

      await message.edit({ embeds: [embed], components: [] });

      await this.saveCampaigns();

      await interaction.reply({
        content: `✅ Campaign "${campaign.title}" has been closed. ${campaign.participants.length} total participants.`,
        flags: 64,
      });
    } catch (error) {
      console.error("Error closing campaign:", error);
      await interaction.reply({
        content: "❌ Error closing campaign.",
        flags: 64,
      });
    }
  }

  async showCampaignStats(interaction) {
    const activeCampaigns = Object.values(this.campaigns).filter(
      (c) => c.active
    );

    if (activeCampaigns.length === 0) {
      return interaction.reply({
        content: "📊 No active campaigns found.",
        flags: 64,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("📊 Vireo Campaign Statistics")
      .setTimestamp();

    activeCampaigns.forEach((campaign) => {
      embed.addFields({
        name: `🎯 ${campaign.title}`,
        value: `Participants: ${
          campaign.participants.length
        }\nCreated: ${new Date(campaign.createdAt).toLocaleDateString()}`,
        inline: true,
      });
    });

    await interaction.reply({
      embeds: [embed],
      flags: 64,
    });
  }

  async listCampaigns(interaction) {
    const campaigns = Object.values(this.campaigns);

    if (campaigns.length === 0) {
      return interaction.reply({
        content: "📋 No campaigns found.",
        flags: 64,
      });
    }

    let response = "📋 **All Campaigns:**\n\n";
    campaigns.forEach((campaign) => {
      const status = campaign.active ? "🟢 Active" : "🔴 Closed";
      response += `**${campaign.title}** (ID: ${campaign.id})\n`;
      response += `Status: ${status} | Participants: ${campaign.participants.length}\n\n`;
    });

    await interaction.reply({
      content: response,
      flags: 64,
    });
  }

  botHasPermissions(guild, perms) {
    try {
      const me = guild?.members?.me;
      if (!me || !me.permissions) return false;
      return me.permissions.has(perms);
    } catch (err) {
      console.error("Error checking bot permissions:", err);
      return false;
    }
  }

  async registerCommands() {
    if (!BOT_TOKEN || !CLIENT_ID) {
      throw new Error(
        "Missing required env vars: BOT_TOKEN and CLIENT_ID are required to register slash commands."
      );
    }

    const commands = [
      new SlashCommandBuilder()
        .setName("create-campaign")
        .setDescription("Create a new campaign embed (opens a modal)")
        .addStringOption((option) =>
          option
            .setName("logo")
            .setDescription("Logo URL (optional)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("button-text")
            .setDescription('Button text (default: "Start Clipping")')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("button-emoji")
            .setDescription('Button emoji (default: "🎬")')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("button-style")
            .setDescription("Button color style")
            .setRequired(false)
            .addChoices(
              { name: "Green (Success)", value: "Success" },
              { name: "Blue (Primary)", value: "Primary" },
              { name: "Gray (Secondary)", value: "Secondary" },
              { name: "Red (Danger)", value: "Danger" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("embed-color")
            .setDescription("Embed color in hex (default: 4CAF50)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("embed-title")
            .setDescription('Embed title (default: "🎯 Vireo Opportunities")')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("footer-text")
            .setDescription('Footer text (default: "Powered by Vireo")')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("category-name")
            .setDescription("Category name for private channels")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("channel-prefix")
            .setDescription('Channel name suffix (default: "workspace")')
            .setRequired(false)
        ),

      new SlashCommandBuilder()
        .setName("close-campaign")
        .setDescription("Close a campaign")
        .addStringOption((option) =>
          option
            .setName("campaign-id")
            .setDescription("Campaign ID to close")
            .setRequired(true)
        ),

      new SlashCommandBuilder()
        .setName("campaign-stats")
        .setDescription("Show statistics for active campaigns"),

      new SlashCommandBuilder()
        .setName("list-campaigns")
        .setDescription("List all campaigns with their IDs"),
      new SlashCommandBuilder()
        .setName("bot-audit")
        .setDescription(
          "Show bot permission audit for this guild (admin only)"
        ),
    ].map((command) => command.toJSON());

    const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

    try {
      console.log("Started refreshing application (/) commands.");

      if (GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
          body: commands,
        });
      } else {
        await rest.put(Routes.applicationCommands(CLIENT_ID), {
          body: commands,
        });
      }

      console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
      console.error("Error registering commands:", error);
    }
  }

  async start() {
    if (!BOT_TOKEN) {
      console.error(
        "FATAL: BOT_TOKEN is not set or is invalid in environment. Set BOT_TOKEN in .env or the process environment."
      );
      process.exit(1);
    }

    try {
      await this.registerCommands();
    } catch (err) {
      console.error("Error registering commands:", err.message || err);
    }

    try {
      await this.client.login(BOT_TOKEN);
    } catch (err) {
      console.error("Login failed:", err.message || err);
      process.exit(1);
    }
  }
}

const bot = new VireoCampaignBot();
bot.start().catch(console.error);

process.on("SIGINT", () => {
  console.log("Shutting down Vireo Campaign Bot...");
  bot.client.destroy();
  process.exit(0);
});
