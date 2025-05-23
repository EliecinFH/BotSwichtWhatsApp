const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const config = {
    PROPRIETARIO_NUMERO: process.env.PROPRIETARIO_NUMERO || '55numeroPropietario@c.us',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MONGODB_URI: process.env.MONGODB_URI,
    BOT_NAME: process.env.BOT_NAME || 'Assistente de Vendas',
    TEMPO_ESPERA_MENU: 1000, // 1 segundo
    LOG_PATH: process.env.LOG_FILE_PATH || 'src/logs/app.log'
};

module.exports = config; 
