import { config } from '../src/config.js';
import { ClistClient } from '../src/clist/client.js';
import { getDatabaseAdapter } from '../src/database/connection.js';
import { runMigrations } from '../src/database/migrate.js';
import { DiscordClient } from '../src/discord/client.js';
import { logger } from '../src/utils/logger.js';

async function runDiagnostics() {
  console.log('========================================');
  console.log('🔍 Discord Contest Notifier — Diagnostics');
  console.log('========================================\n');

  // 1. Check Configuration
  console.log('1️⃣  Checking Environment Variables:');
  console.log(`   - CLIST_USERNAME: ${config.clist.username ? '✅ Configured (' + config.clist.username + ')' : '⚠️ Not set'}`);
  console.log(`   - CLIST_API_KEY: ${config.clist.apiKey ? '✅ Configured' : '⚠️ Not set'}`);
  console.log(`   - DATABASE_URL: ${config.database.url.startsWith('postgresql') ? '✅ PostgreSQL Configured' : 'ℹ️ Using SQLite (' + config.database.url + ')'}`);
  console.log(`   - DISCORD_BOT_TOKEN: ${config.discord.botToken ? '✅ Configured' : '⚠️ Not set'}`);
  console.log(`   - DEFAULT_STARTED_CHANNEL: ${config.discord.defaultStartedChannelId || '⚠️ Not set'}`);
  console.log(`   - DEFAULT_DAILY_CHANNEL: ${config.discord.defaultDailyChannelId || '⚠️ Not set'}`);
  console.log(`   - DEFAULT_WEEKLY_CHANNEL: ${config.discord.defaultWeeklyChannelId || '⚠️ Not set'}`);
  console.log(`   - DEFAULT_WEBHOOK_URL: ${config.discord.defaultWebhookUrl ? '✅ Configured' : 'ℹ️ None (using bot token)'}`);
  console.log(`   - DEFAULT_TIMEZONE: ${config.defaultTimezone}\n`);

  // 2. Test Database Connection & Migrations
  console.log('2️⃣  Testing Database Connection:');
  try {
    const db = getDatabaseAdapter();
    await runMigrations(db);
    const tables = await db.query(
      config.database.url.startsWith('postgresql')
        ? "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        : "SELECT name as table_name FROM sqlite_master WHERE type='table'"
    );
    console.log(`   ✅ Database connected and migrated successfully! Tables found: ${tables.map((t: any) => t.table_name || t.name).join(', ')}\n`);
  } catch (err: any) {
    console.error(`   ❌ Database connection failed:`, err.message, '\n');
  }

  // 3. Test CLIST API
  console.log('3️⃣  Testing CLIST API Connection:');
  try {
    const clist = new ClistClient();
    const contests = await clist.fetchContests({ upcoming: true, limit: 3 });
    console.log(`   ✅ Successfully fetched ${contests.length} upcoming contests from CLIST:`);
    for (const c of contests) {
      console.log(`      • [${c.platform.toUpperCase()}] ${c.name} (Starts: ${c.startTime.toISOString()})`);
    }
    console.log('');
  } catch (err: any) {
    console.error(`   ❌ CLIST API fetch failed:`, err.message, '\n');
  }

  // 4. Test Discord Delivery
  console.log('4️⃣  Testing Discord Delivery:');
  const targetChannel = config.discord.defaultStartedChannelId;
  const targetWebhook = config.discord.defaultWebhookUrl;

  if (!targetChannel && !targetWebhook) {
    console.log('   ⚠️ Skipping Discord test: Neither DEFAULT_STARTED_CHANNEL_ID nor DEFAULT_WEBHOOK_URL is set in .env\n');
  } else {
    try {
      const discord = new DiscordClient();
      console.log(`   Sending test notification to Discord...`);
      const sent = await discord.sendMessage(
        {
          embeds: [
            {
              title: '🤖 Bot Diagnostic Test',
              description: 'Your **Discord Contest Notifier** is connected and ready to send notifications!',
              color: 0x57f287,
              fields: [
                { name: 'Status', value: 'Online & Operational', inline: true },
                { name: 'Configured Timezone', value: config.defaultTimezone, inline: true },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        },
        {
          channelId: targetChannel,
          webhookUrl: targetWebhook,
          timezone: config.defaultTimezone,
        }
      );

      if (sent) {
        console.log('   ✅ Test message sent to Discord successfully! Check your Discord channel.\n');
      } else {
        console.log('   ⚠️ Message delivery returned false. Check channel permissions.\n');
      }
    } catch (err: any) {
      console.error(`   ❌ Discord delivery failed:`, err.message, '\n');
    }
  }

  console.log('========================================');
  console.log('🎉 Diagnostics complete!');
  console.log('========================================');
  process.exit(0);
}

runDiagnostics().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
