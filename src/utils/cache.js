const Redis = require('ioredis');
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

module.exports = new Cache();