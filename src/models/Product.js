const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    code: {
        type: String,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    unit: {
        type: String,
        default: 'UNID'
    },
    imageUrl: String,
    active: {
        type: Boolean,
        default: true
    },
    stock: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Product', productSchema); 