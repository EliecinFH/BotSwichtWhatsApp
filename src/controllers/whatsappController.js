const WhatsAppService = require('../services/whatsappService');
const logger = require('../utils/logger');

class WhatsAppController {
    constructor(client) {
        this.whatsappService = new WhatsAppService(client);
    }

    async handleMessage(message) {
        try {
            await this.whatsappService.processMessage(message);
        } catch (error) {
            logger.error('Erro no controlador de WhatsApp:', error);
        }
    }

    async handleQR(qr) {
        try {
            console.clear();
            console.log('Escaneie o QR Code abaixo:');
            require('qrcode-terminal').generate(qr, { small: true });
        } catch (error) {
            logger.error('Erro ao gerar QR code:', error);
        }
    }
}

module.exports = WhatsAppController;
