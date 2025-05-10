const logger = require('../utils/logger');
const openai = require('../config/openai');
const Conversation = require('../models/Conversation');

class MessageHandler {
    constructor() {
        this.defaultResponse = "Olá! Como posso ajudar?\n\n" +
            "Comandos disponíveis:\n" +
            "- *produtos* - Ver nosso catálogo\n" +
            "- *carrinho* - Ver seu carrinho\n" +
            "- *vendedor* - Falar com atendente\n";
    }

    async handleNormalMessage(message, client) {
        try {
            const userId = message.from;
            const messageContent = message.body.trim();

            // Salvar mensagem na conversa
            await this.saveToConversation(userId, messageContent, 'user');

            // Processar com IA e gerar resposta
            const aiResponse = await this.processWithAI(messageContent, userId);

            // Salvar resposta do bot na conversa
            await this.saveToConversation(userId, aiResponse, 'bot');

            // Enviar resposta
            await message.reply(aiResponse);

            // Enviar menu de ajuda após a resposta natural
            setTimeout(async () => {
                await client.sendMessage(userId, this.defaultResponse);
            }, 1000);

        } catch (error) {
            logger.error('Erro ao processar mensagem normal:', error);
            await message.reply(this.defaultResponse);
        }
    }

    async saveToConversation(phoneNumber, content, sender) {
        try {
            let conversation = await Conversation.findOne({ phoneNumber });
            
            if (!conversation) {
                conversation = new Conversation({
                    phoneNumber,
                    messages: [],
                    lastInteraction: new Date()
                });
            }

            conversation.messages.push({
                content,
                timestamp: new Date(),
                sender,
                sentiment: 'neutral' // Poderia ser implementada análise de sentimento aqui
            });

            conversation.lastInteraction = new Date();
            await conversation.save();

        } catch (error) {
            logger.error('Erro ao salvar conversa:', error);
        }
    }

    async processWithAI(message, phoneNumber) {
        try {
            // Recupera histórico recente
            const conversation = await Conversation.findOne({ phoneNumber })
                .sort({ 'messages.timestamp': -1 })
                .limit(5);

            const contextMessages = conversation
                ? conversation.messages.map(msg => ({
                    role: msg.sender === 'user' ? 'user' : 'assistant',
                    content: msg.content
                }))
                : [];

            const completion = await openai.createChatCompletion({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "Você é um assistente de vendas prestativo e amigável. Mantenha as respostas curtas e diretas. Se o cliente perguntar sobre produtos ou preços, sugira usar o comando 'produtos'."
                    },
                    ...contextMessages,
                    {
                        role: "user",
                        content: message
                    }
                ]
            });

            return completion.data.choices[0].message.content;
        } catch (error) {
            logger.error('Erro ao processar mensagem com IA:', error);
            return "Desculpe, não entendi. Como posso ajudar com nossos produtos?";
        }
    }

    isCommand(text) {
        const commands = ['produtos', 'carrinho', 'finalizar', 'ajuda', 'vendedor', 'atendente', 'catalogo', 'cardapio'];
        return commands.includes(text.toLowerCase().trim());
    }
}

module.exports = new MessageHandler(); 