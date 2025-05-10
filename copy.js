const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
    // Criar diretório de destino se não existir
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    // Verificar se o diretório fonte existe
    if (!fs.existsSync(src)) {
        console.log(`Diretório não encontrado: ${src}`);
        return;
    }

    // Ler conteúdo do diretório
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        try {
            if (entry.isDirectory()) {
                // Se for diretório, copiar recursivamente
                copyDir(srcPath, destPath);
                console.log(`✓ Diretório copiado: ${entry.name}`);
            } else {
                // Se for arquivo, copiar
                fs.copyFileSync(srcPath, destPath);
                console.log(`✓ Arquivo copiado: ${entry.name}`);
            }
        } catch (error) {
            console.error(`Erro ao copiar ${entry.name}:`, error.message);
        }
    }
}

console.log('Iniciando cópia de arquivos...\n');

try {
    // Copiar models
    console.log('Copiando models...');
    copyDir('models', 'src/models');

    // Copiar utils
    console.log('\nCopiando utils...');
    copyDir('utils', 'src/utils');

    // Copiar routes
    console.log('\nCopiando routes...');
    copyDir('routes', 'src/routes');

    // Copiar app.js
    console.log('\nCopiando app.js...');
    if (fs.existsSync('app.js')) {
        fs.copyFileSync('app.js', 'src/app.js');
        console.log('✓ app.js copiado');
    } else {
        console.log('app.js não encontrado');
    }

    console.log('\nCópia de arquivos concluída!');
    console.log('\nPróximos passos:');
    console.log('1. Verifique se os arquivos foram copiados corretamente em src/');
    console.log('2. Atualize o package.json para apontar para src/app.js');
    console.log('3. Execute: npm install');
    console.log('4. Inicie o projeto com: npm run dev');

} catch (error) {
    console.error('Erro durante a cópia:', error.message);
}

const app = express();

// Middlewares de segurança implementados
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));