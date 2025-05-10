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
    userId: { type: String, required: true, unique: true },
    items: [
        {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            name: String,
            price: Number,
            quantity: Number
        }
    ],
    total: { type: Number, default: 0 },
    state: { type: String, default: 'menu_principal' },
    address: { type: String },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // 24 horas
    }
});

module.exports = mongoose.model('Cart', CartSchema); 