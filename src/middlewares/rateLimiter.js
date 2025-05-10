const rateLimit = require('express-rate-limit');
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

module.exports = limiter;