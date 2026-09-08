import { registerSlashCommands } from '../src/discord/commands.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  console.log('Registering Discord slash commands...');
  try {
    await registerSlashCommands();
    console.log('✅ Slash commands successfully registered with Discord API!');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Failed to register slash commands:', err.message);
    process.exit(1);
  }
}

main();
