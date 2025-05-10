const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { importProductsFromPDF } = require('../utils/pdfImporter');
const Product = require('../models/Product');

// Rota para importar produtos do PDF
router.post('/import-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo PDF enviado' });
        }
        const products = await importProductsFromPDF(req.file.path);
        res.json({ message: 'Produtos importados com sucesso', products });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todos os produtos
router.get('/', async (req, res) => {
    try {
        const products = await Product.find({ active: true });
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Adicionar produto manualmente
router.post('/', async (req, res) => {
    try {
        const product = new Product(req.body);
        await product.save();
        res.status(201).json(product);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router; 