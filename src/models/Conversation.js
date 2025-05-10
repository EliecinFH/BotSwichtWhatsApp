const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true
    },
    messages: [{
        content: String,
        timestamp: Date,
        sender: String, // 'user' ou 'bot'
        sentiment: {
            type: String,
            enum: ['positive', 'negative', 'neutral'],
            default: 'neutral'
        }
    }],
    lastInteraction: Date
});

module.exports = mongoose.model('Conversation', conversationSchema); 