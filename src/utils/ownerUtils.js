const { PROPRIETARIO_NUMERO } = require('../config/config');

function ehProprietario(numero) {
    try {
        // Normaliza os números para comparação
        const numeroNormalizado = numero.replace(/[^\d@]/g, '');
        const proprietarioNormalizado = PROPRIETARIO_NUMERO.replace(/[^\d@]/g, '');
        return numeroNormalizado === proprietarioNormalizado;
    } catch (error) {
        console.error('Erro ao verificar proprietário:', error);
        return false; // Em caso de erro, retorna falso por segurança
    }
}

// Função auxiliar para validar número de telefone
function validarNumeroTelefone(numero) {
    try {
        return numero.includes('@c.us') ? numero : `${numero}@c.us`;
    } catch (error) {
        console.error('Erro ao validar número:', error);
        return numero;
    }
}

module.exports = { 
    ehProprietario,
    validarNumeroTelefone
}; 