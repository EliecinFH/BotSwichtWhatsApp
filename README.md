# Bot WhatsApp com IA

Bot de WhatsApp para automação de atendimento com integração de IA generativa.

## Funcionalidades

- Atendimento automatizado via WhatsApp
- Integração com OpenAI para respostas inteligentes
- Sistema de gerenciamento de produtos
- Processamento de pedidos
- Análise de sentimentos
- Histórico de conversas
- Aprendizado baseado em interações anteriores

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Configure o arquivo `.env` com suas credenciais
4. Inicie o servidor:
   ```bash
   npm start
   ```

## Variáveis de Ambiente

Crie um arquivo `.env` com as seguintes variáveis:

- `OPENAI_API_KEY`: Sua chave API da OpenAI
- `MONGODB_URI`: URI de conexão com MongoDB
- `PORT`: Porta do servidor (padrão: 3000)

## Uso

1. Inicie o servidor
2. Escaneie o QR Code com seu WhatsApp
3. Comece a usar!

## API Endpoints

- `GET /api/products`: Lista todos os produtos
- `POST /api/products`: Adiciona um novo produto

## Estrutura do Projeto 

## Executando com Docker

Este projeto possui configuração pronta para Docker e Docker Compose, facilitando a execução em ambientes isolados.

### Requisitos

- Docker
- Docker Compose

### Variáveis de Ambiente

Certifique-se de criar um arquivo `.env` na raiz do projeto com as seguintes variáveis:

- `OPENAI_API_KEY`: Sua chave API da OpenAI
- `MONGODB_URI`: URI de conexão com MongoDB (pode ser omitida para usar o serviço `mongo` do Compose)
- `PORT`: Porta do servidor (padrão: 3000)

> **Importante:** O arquivo `.env` **não** é incluído na imagem Docker por padrão. Ele deve ser fornecido no momento da execução.

### Como executar

1. Construa e inicie os serviços com Docker Compose:
   ```bash
   docker compose up --build
   ```
   Isso irá:
   - Construir a imagem do app Node.js (Node 22.13.1-slim)
   - Subir o serviço do app (`js-app`) e do MongoDB (`mongo`)

2. O app estará disponível em:
   - http://localhost:3000

3. O MongoDB estará disponível em:
   - localhost:27017 (usuário: `root`, senha: `example`)

### Portas Expostas

- `js-app`: 3000
- `mongo`: 27017

### Observações Específicas

- O serviço Node.js é executado como usuário não-root para maior segurança.
- Dependências de sistema para o Puppeteer já estão incluídas na imagem.
- Os diretórios `.wwebjs_auth/session`, `.wwebjs_cache`, `uploads/products` e `logs` são criados automaticamente e utilizados pelo app.
- O serviço MongoDB utiliza volume persistente `mongo-data` para manter os dados entre reinicializações.

### Parar os serviços

Para parar e remover os containers:
```bash
docker compose down
```
