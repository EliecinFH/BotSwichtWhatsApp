const fs = require('fs');
const path = require('path');

// Criar diretórios necessários
const dirs = [
    path.join(__dirname, '..', 'logs'),
    path.join(__dirname, '..', 'uploads'),
    path.join(__dirname, '..', 'temp')
];

function createDirectories() {
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`✓ Diretório criado: ${dir}`);
        }
    });
}

module.exports = { createDirectories }; 