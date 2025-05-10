const fs = require('fs');
const path = require('path');

function createBackup() {
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../backup');

    // Criar diretório de backup se não existir
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    // Lista de arquivos importantes para backup
    const filesToBackup = [
        { src: 'app.js', dest: `app.js.${date}.bak` },
        { src: 'src/config/config.js', dest: `config.js.${date}.bak` },
        { src: 'src/utils/ownerUtils.js', dest: `ownerUtils.js.${date}.bak` }
    ];

    filesToBackup.forEach(file => {
        try {
            if (fs.existsSync(file.src)) {
                const content = fs.readFileSync(file.src);
                fs.writeFileSync(path.join(backupDir, file.dest), content);
                console.log(`Backup criado: ${file.dest}`);
            }
        } catch (error) {
            console.error(`Erro ao criar backup de ${file.src}:`, error);
        }
    });
}

module.exports = { createBackup };
