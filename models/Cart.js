const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    name: String,
    price: Number,
    quantity: {
        type: Number,
        required: true,
        default: 1
    }
});

const CartSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    items: [CartItemSchema],
    total: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // 24 horas
    }
});

module.exports = mongoose.model('Cart', CartSchema); 