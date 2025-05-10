const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error('Erro na aplicação:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Erro de validação',
            details: err.errors
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Não autorizado'
        });
    }

    res.status(500).json({
        error: 'Erro interno do servidor'
    });
};

module.exports = errorHandler;