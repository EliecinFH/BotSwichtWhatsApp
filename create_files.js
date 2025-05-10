const fs = require('fs');
const path = require('path');

const files = [
    {
        path: 'src/config/database.js',
        content: `const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
        });

        mongoose.set('cache', true);
        logger.info(\`MongoDB Conectado: \${conn.connection.host}\`);
    } catch (error) {
        logger.error(\`Erro na conexão com MongoDB: \${error.message}\`);
        process.exit(1);
    }
};

module.exports = connectDB;`
    },
    {
        path: 'src/utils/logger.js',
        content: `const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: { service: 'whatsapp-bot' },
    transports: [
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880,
            maxFiles: 5
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

module.exports = logger;`
    },
    {
        path: 'src/utils/metrics.js',
        content: `const prometheus = require('prom-client');

const register = new prometheus.Registry();
prometheus.collectDefaultMetrics({ register });

const httpRequestDuration = new prometheus.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5]
});

const botMessagesTotal = new prometheus.Counter({
    name: 'bot_messages_total',
    help: 'Total de mensagens processadas pelo bot',
    labelNames: ['type']
});

const activeChats = new prometheus.Gauge({
    name: 'active_chats',
    help: 'Número de chats ativos'
});

register.registerMetric(httpRequestDuration);
register.registerMetric(botMessagesTotal);
register.registerMetric(activeChats);

module.exports = {
    register,
    httpRequestDuration,
    botMessagesTotal,
    activeChats,
    increment: (metric, labels = {}) => {
        if (botMessagesTotal.has(labels)) {
            botMessagesTotal.inc(labels);
        }
    }
};`
    },
    {
        path: 'src/utils/cache.js',
        content: `const Redis = require('ioredis');
const logger = require('./logger');

class Cache {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            maxRetriesPerRequest: 1
        });

        this.redis.on('error', (error) => {
            logger.error('Erro Redis:', error);
        });
    }

    async get(key) {
        try {
            const value = await this.redis.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Erro ao buscar cache:', error);
            return null;
        }
    }

    async set(key, value, ttl = 3600) {
        try {
            await this.redis.set(
                key,
                JSON.stringify(value),
                'EX',
                ttl
            );
        } catch (error) {
            logger.error('Erro ao definir cache:', error);
        }
    }

    async del(key) {
        try {
            await this.redis.del(key);
        } catch (error) {
            logger.error('Erro ao deletar cache:', error);
        }
    }
}

module.exports = new Cache();`
    },
    {
        path: 'src/middlewares/auth.js',
        content: `const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'Autenticação necessária' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        
        next();
    } catch (error) {
        logger.error('Erro de autenticação:', error);
        res.status(401).json({ error: 'Token inválido' });
    }
};

module.exports = auth;`
    },
    {
        path: 'src/middlewares/rateLimiter.js',
        content: `const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');
const logger = require('../utils/logger');

const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
});

redis.on('error', (error) => {
    logger.error('Erro na conexão Redis:', error);
});

const limiter = rateLimit({
    store: new RedisStore({
        client: redis,
        prefix: 'rate_limit:'
    }),
    windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX || 100,
    message: {
        error: 'Muitas requisições, tente novamente em 15 minutos'
    }
});

module.exports = limiter;`
    },
    {
        path: 'src/middlewares/errorHandler.js',
        content: `const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error('Erro na aplicação:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Erro de validação',
            details: err.errors
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Não autorizado'
        });
    }

    res.status(500).json({
        error: 'Erro interno do servidor'
    });
};

module.exports = errorHandler;`
    },
    {
        path: 'src/services/whatsappService.js',
        content: `const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const cache = require('../utils/cache');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

class WhatsAppService {
    constructor(client) {
        this.client = client;
    }

    async processMessage(message) {
        try {
            metrics.botMessagesTotal.inc({ type: 'received' });
            
            if (message.from.includes('@g.us')) return;

            const userId = message.from;
            const mensagem = message.body.toLowerCase().trim();

            // Verificar cache para estado do usuário
            const userState = await cache.get(\`userState:\${userId}\`);
            
            if (this.isCommand(mensagem)) {
                return this.processCommand(message, mensagem);
            }

            // Processamento normal da mensagem
            await this.processNormalMessage(message);

        } catch (error) {
            logger.error('Erro ao processar mensagem:', error);
            await message.reply('Desculpe, ocorreu um erro. Por favor, tente novamente.');
        }
    }

    async processCommand(message, command) {
        try {
            switch (command) {
                case 'produtos':
                    return this.listProducts(message);
                case 'carrinho':
                    return this.viewCart(message);
                default:
                    return message.reply('Comando não reconhecido');
            }
        } catch (error) {
            logger.error('Erro ao processar comando:', error);
            throw error;
        }
    }

    isCommand(text) {
        const commands = ['produtos', 'carrinho', 'finalizar', 'ajuda'];
        return commands.includes(text);
    }
}

module.exports = WhatsAppService;`
    }
];

console.log('Criando arquivos...\n');

files.forEach(file => {
    try {
        const dir = path.dirname(file.path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file.path, file.content);
        console.log(`✓ Arquivo criado: ${file.path}`);
    } catch (error) {
        console.error(`Erro ao criar ${file.path}:`, error.message);
    }
});

console.log('\nCriação de arquivos concluída!');
console.log('\nPróximos passos:');
console.log('1. Verifique se todos os arquivos foram criados corretamente');
console.log('2. Execute: npm install');
console.log('3. Configure suas variáveis no arquivo .env');
console.log('4. Inicie o projeto com: npm run dev');
