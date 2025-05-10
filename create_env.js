const fs = require('fs');
const crypto = require('crypto');

// Gerar JWT_SECRET seguro
const jwtSecret = crypto.randomBytes(64).toString('hex');

const envContent = `# Ambiente
NODE_ENV=development
PORT=3000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/botwhatsapp

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Segurança
JWT_SECRET=${jwtSecret}
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# OpenAI
OPENAI_API_KEY=sua_chave_api_openai

# WhatsApp
PROPRIETARIO_NUMERO=557196177635@c.us

# Configurações do Bot
BOT_NAME=BotWhatsApp
BOT_WELCOME_MESSAGE=Olá! Sou o assistente virtual. Como posso ajudar?

# Logs
LOG_LEVEL=info
LOG_FILE_PATH=logs/app.log

# Cache
CACHE_TTL=3600`;

// Criar arquivo .env
fs.writeFileSync('.env', envContent);
console.log('✓ Arquivo .env criado com sucesso!');
console.log('\nPróximos passos:');
console.log('1. Substitua OPENAI_API_KEY com sua chave da API da OpenAI');
console.log('2. Verifique se o PROPRIETARIO_NUMERO está correto');
console.log('3. Ajuste outras configurações conforme necessário\n');
