import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Env } from './index';
import { sessionCommandDef, handleSessionCommand } from './commands/session';

export async function startBot(env: Env): Promise<void> {
  const client = new Client({
    intents: [
      // Required to receive guild/channel info
      GatewayIntentBits.Guilds,
      // Required to detect voice state changes (who joins / leaves)
      GatewayIntentBits.GuildVoiceStates,
      // Required to send messages in text channels (consent notice, status)
      GatewayIntentBits.GuildMessages,
    ],
  });

  await registerCommands(env);

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ Bot ready — logged in as ${readyClient.user.tag}`);
    console.log(`   Registered in guild: ${env.DISCORD_GUILD_ID}`);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void dispatchCommand(interaction, env);
  });

  await client.login(env.DISCORD_TOKEN);
}

// ── Command dispatch ────────────────────────────────────────

async function dispatchCommand(
  interaction: ChatInputCommandInteraction,
  env: Env,
): Promise<void> {
  try {
    if (interaction.commandName === 'session') {
      await handleSessionCommand(interaction, env);
      return;
    }
    await interaction.reply({ content: '❓ Commande inconnue.', ephemeral: true });
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err);
    const errorReply = { content: '❌ Une erreur est survenue.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  }
}

// ── Slash command registration ──────────────────────────────

async function registerCommands(env: Env): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const body = [sessionCommandDef.toJSON()];

  console.log('🔄 Registering slash commands...');
  await rest.put(
    // Guild-scoped: instant registration, ideal for development.
    // For production, switch to Routes.applicationCommands(clientId)
    // but commands will take up to 1 hour to propagate globally.
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body },
  );
  console.log('✅ Slash commands registered.');
}
