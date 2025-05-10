const express = require('express');
const router = express.Router();

// Exemplo de rota de admin
router.get('/admin/ping', (req, res) => {
    res.json({ status: 'ok' });
});

module.exports = router;
