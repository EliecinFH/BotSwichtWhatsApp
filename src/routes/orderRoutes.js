// src/routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// Listar todos os pedidos
router.get('/orders', async (req, res) => {
    try {
        const orders = await Order.find().populate('products.product');
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar pedidos.' });
    }
});

// Criar um novo pedido
router.post('/orders', async (req, res) => {
    try {
        const { phoneNumber, products, total } = req.body;
        const order = new Order({ phoneNumber, products, total });
        await order.save();
        res.status(201).json(order);
    } catch (error) {
        res.status(400).json({ error: 'Erro ao criar pedido.' });
    }
});

// Buscar pedido por ID
router.get('/orders/:id', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('products.product');
        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar pedido.' });
    }
});

module.exports = router;