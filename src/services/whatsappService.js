const logger = require('../utils/logger');
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
            const userState = await cache.get(`userState:${userId}`);
            
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

module.exports = WhatsAppService;