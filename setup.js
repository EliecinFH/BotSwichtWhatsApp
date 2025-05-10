const fs = require("fs");
const path = require("path");

// Função para criar diretório se não existir
const createDirIfNotExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Diretório criado: ${dir}`);
  }
};

// Função para copiar arquivo ou diretório recursivamente
const copyFileOrDir = (from, to) => {
  if (fs.existsSync(from)) {
    if (fs.lstatSync(from).isDirectory()) {
      createDirIfNotExists(to);
      fs.readdirSync(from).forEach((element) => {
        copyFileOrDir(path.join(from, element), path.join(to, element));
      });
      console.log(`✓ Copiado diretório: ${from} -> ${to}`);
    } else {
      fs.copyFileSync(from, to);
      console.log(`✓ Copiado arquivo: ${from} -> ${to}`);
    }
  }
};

console.log("Iniciando reorganização do projeto...\n");

// 1. Criar estrutura de diretórios
console.log("1. Criando estrutura de diretórios...");
const directories = [
  "src/config",
  "src/controllers",
  "src/services",
  "src/middlewares",
  "src/routes",
  "src/utils",
  "src/models",
  "src/tests/unit",
  "src/tests/integration",
  "logs",
];

directories.forEach((dir) => createDirIfNotExists(dir));

// 2. Copiar arquivos existentes
console.log("\n2. Copiando arquivos existentes...");
const filesToCopy = [
  { from: "models", to: "src/models" },
  { from: "utils", to: "src/utils" },
  { from: "routes", to: "src/routes" },
  { from: "app.js", to: "src/app.js" },
];

filesToCopy.forEach(({ from, to }) => copyFileOrDir(from, to));

// 3. Criar arquivo .env se não existir
if (!fs.existsSync(".env")) {
  console.log("\n3. Criando arquivo .env...");
  const envContent = `NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/botwhatsapp
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=seu_secret_muito_seguro
OPENAI_API_KEY=sua_chave_api
PROPRIETARIO_NUMERO=5574988169498@c.us
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100`;

  fs.writeFileSync(".env", envContent);
  console.log("✓ Arquivo .env criado");
}

// 4. Atualizar package.json
console.log("\n4. Atualizando package.json...");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
packageJson.main = "src/app.js";
packageJson.scripts = {
  ...packageJson.scripts,
  start: "node src/app.js",
  dev: "nodemon src/app.js",
  test: "jest",
  lint: "eslint src/",
  format: "prettier --write 'src/**/*.js'",
};

fs.writeFileSync("package.json", JSON.stringify(packageJson, null, 2));
console.log("✓ package.json atualizado");

console.log("\nReorganização do projeto concluída com sucesso!");
console.log("\nPróximos passos:");
console.log(
  "1. Verifique se os arquivos foram copiados corretamente para a pasta src/"
);
console.log(
  "2. Se tudo estiver correto, você pode deletar os arquivos antigos manualmente"
);
console.log("3. Execute: npm install");
console.log("4. Configure suas variáveis no arquivo .env");
console.log("5. Inicie o projeto com: npm run dev");
