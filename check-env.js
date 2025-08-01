const required = ['BOT_TOKEN', 'DATABASE_URL', 'RENDER_EXTERNAL_HOSTNAME', 'REQUIRED_CHANNELS'];
require('dotenv').config();
const missing = required.filter(k => !process.env[k] || process.env[k].trim() === '');
if (missing.length) {
  console.error('Missing env vars:', missing.join(', '));
  process.exit(1);
}
console.log('All required env vars present.');
