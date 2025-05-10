const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const { MessageMedia } = require("whatsapp-web.js");
const {
  importProductsFromPDF,
  extractProductsFromPDF,
} = require("./utils/pdfImporter");
const { importProductsFromXML } = require("./utils/xmlImporter");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const Cart = require("./models/Cart");
const logger = require("./utils/logger");
const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis");
const Redis = require("ioredis");
const winston = require("winston");
const prometheus = require("prom-client");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const errorHandler = require("./middlewares/errorHandler");
const metrics = require("./utils/metrics");
const cache = require("./utils/cache");
const { Buttons, List } = require("whatsapp-web.js");
const { setTimeout } = require("timers/promises");

// Importação dos modelos
const Conversation = require("./models/Conversation");
const Product = require("./models/Product");
const Order = require("./models/Order");

// Alterar o import da rota de produtos
const productRoutes = require("./routes/productRoutes"); // Era './routes/productRoutes'

// Debug das variáveis de ambiente
console.log("=== Variáveis de Ambiente ===");
console.log({
  nodeEnv: process.env.NODE_ENV,
  mongoUri: process.env.MONGODB_URI,
  port: process.env.PORT,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  openaiKey: process.env.OPENAI_API_KEY ? "Configurada" : "Não configurada",
  proprietarioNumero: process.env.PROPRIETARIO_NUMERO,
  botName: process.env.BOT_NAME,
});
console.log("==========================");

// Conexão com MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    logger.info(`MongoDB Conectado: ${conn.connection.host}`);

    // Implementar cache do mongoose
    //mongoose.set('cache', true);
  } catch (error) {
    logger.error(`Erro: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

// Configuração do OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuração do cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
    browserArgs: [
      "--disable-web-security",
      "--no-sandbox",
      "--disable-web-security",
      "--aggressive-cache-discard",
      "--disable-cache",
      "--disable-application-cache",
      "--disable-offline-load-stale-cache",
      "--disk-cache-size=0",
    ],
  },
});

// Evento de QR Code
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true }, (qrcode) => {
    console.clear();
    console.log("Escaneie o QR Code abaixo:");
    console.log(qrcode);
    console.log("\nAguardando leitura do QR Code...");
  });
});

client.on("ready", () => {
  console.clear();
  console.log("✅ WhatsApp conectado com sucesso!");
  console.log("Bot está pronto para receber mensagens.");
});

client.on("authenticated", () => {
  console.log("Autenticado com sucesso!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Falha na autenticação:", msg);
});

client.on("disconnected", (reason) => {
  console.log("❌ WhatsApp desconectado:", reason);
  // Tentar reconectar após 5 segundos
  setTimeout(() => {
    client.initialize().catch((err) => {
      console.error("Erro ao reinicializar:", err);
    });
  }, 5000);
});

// Tratamento de erros global
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

// Inicialização com tratamento de erro
async function initializeWhatsApp() {
  try {
    console.log("Iniciando WhatsApp Bot...");
    await client.initialize();
  } catch (error) {
    console.error("Erro na inicialização:", error);
    setTimeout(initializeWhatsApp, 5000);
  }
}

// Iniciar o cliente
initializeWhatsApp();

// Função para análise de sentimento usando OpenAI
async function analyzeSentiment(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Analise o sentimento do texto a seguir e responda apenas com: positive, negative ou neutral",
        },
        {
          role: "user",
          content: text,
        },
      ],
    });
    return response.choices[0].message.content.trim().toLowerCase();
  } catch (error) {
    console.error("Erro na análise de sentimento:", error);
    return "neutral";
  }
}

// Função para processar mensagens com IA e contexto
async function processMessageWithAI(message, phoneNumber) {
  try {
    // Recupera histórico recente
    const conversation = await Conversation.findOne({ phoneNumber })
      .sort({ "messages.timestamp": -1 })
      .limit(5);

    const contextMessages = conversation
      ? conversation.messages.map((msg) => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.content,
        }))
      : [];

    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente de vendas prestativo e amigável. Use o histórico da conversa para contextualizar suas respostas.",
        },
        ...contextMessages,
        {
          role: "user",
          content: message,
        },
      ],
    });
    return completion.data.choices[0].message.content;
  } catch (error) {
    console.error("Erro ao processar mensagem com IA:", error);
    return "Desculpe, tive um problema ao processar sua mensagem. Como posso ajudar de outra forma?";
  }
}

// Função para formatar preço em Reais
function formatPrice(price) {
  return price.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Função auxiliar para enviar mensagem com retry
async function sendMessageWithRetry(client, to, text, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.sendMessage(to, text);
      return true;
    } catch (error) {
      console.error(`Tentativa ${i + 1} falhou:`, error);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000)); // espera 2 segundos entre tentativas
    }
  }
}

// Configurações do proprietário
const PROPRIETARIO_NUMERO = "557196177635@c.us"; // Substitua pelo seu número no formato: código do país + DDD + número

// Lista de usuários em atendimento com vendedor
const usuariosComVendedor = new Set();

// Lista de palavras-chave que indicam interesse de compra (reduzida)
const palavrasChaveCompra = [
  "preço",
  "valor",
  "quanto custa",
  "quero comprar",
  "produtos",
  "catalogo",
  "cardápio",
  "comprar",
  "vendedor",
  "atendente",
];

// Função para verificar se a mensagem contém palavras-chave
function temInteresseCompra(mensagem) {
  return palavrasChaveCompra.some((palavra) =>
    mensagem.includes(palavra.toLowerCase())
  );
}

// Função para verificar se é mensagem do proprietário
function ehProprietario(numero) {
  return numero === PROPRIETARIO_NUMERO;
}

// Função para encaminhar mensagem para o proprietário
async function encaminharParaProprietario(message) {
  try {
    if (!message || !message.from || !message.body) {
      throw new Error("Mensagem inválida para encaminhamento.");
    }

    const mensagemEncaminhada = `📩 Nova mensagem de: ${message.from}\n\n${message.body}`;
    await client.sendMessage(PROPRIETARIO_NUMERO, mensagemEncaminhada);
    console.log("Mensagem encaminhada com sucesso para o proprietário.");
  } catch (error) {
    console.error("Erro ao encaminhar mensagem para o proprietário:", error);
  }
}

// Função para obter saudação baseada na hora
function getSaudacao() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) {
    return "Bom dia";
  } else if (hora >= 12 && hora < 18) {
    return "Boa tarde";
  } else {
    return "Boa noite";
  }
}

// Função para processar lista de produtos
async function processarListaProdutos(message) {
  try {
    const produtos = message.body
      .toLowerCase()
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");

    let carrinho = [];
    let produtosNaoEncontrados = [];
    let resposta = "🛒 *Produtos encontrados:*\n\n";
    let valorTotal = 0;

    for (const nomeProduto of produtos) {
      const produto = await Product.findOne({
        name: { $regex: new RegExp(nomeProduto, "i") },
      });

      if (produto) {
        carrinho.push(produto);
        valorTotal += produto.price;
        resposta += `✅ *${produto.name}*\n`;
        resposta += `💰 Preço: R$ ${produto.price.toFixed(2)}\n\n`;
      } else {
        produtosNaoEncontrados.push(nomeProduto);
      }
    }

    if (produtosNaoEncontrados.length > 0) {
      resposta += `❌ *Produtos não encontrados:*\n${produtosNaoEncontrados.join(
        "\n"
      )}\n\n`;
    }

    resposta += `*Valor Total: R$ ${valorTotal.toFixed(2)}*\n\n`;
    resposta += `Para confirmar o pedido, digite "confirmar pedido"\n`;
    resposta += `Para cancelar, digite "cancelar pedido"\n`;
    resposta += `Para adicionar mais produtos, envie nova lista separada por vírgulas`;

    // Salva o carrinho temporariamente
    await Cart.findOneAndUpdate(
      { userId: message.from },
      {
        userId: message.from,
        items: carrinho,
        total: valorTotal,
      },
      { upsert: true, new: true }
    );

    await message.reply(resposta);
  } catch (error) {
    console.error("Erro ao processar lista de produtos:", error);
    await message.reply(
      "Desculpe, ocorreu um erro ao processar sua lista de produtos."
    );
  }
}

// Função para consultar produto específico
async function consultarProduto(message, nomeProduto) {
  try {
    const produto = await Product.findOne({
      name: { $regex: new RegExp(nomeProduto, "i") },
    });

    if (produto) {
      const resposta =
        `*${produto.name}*\n` +
        `💰 Preço: R$ ${produto.price.toFixed(2)}\n` +
        `📦 Código: ${produto.code || "Não disponível"}\n\n` +
        `🛒 Para fazer um pedido, envie uma lista de produtos separados por vírgula.\n` +
        `Exemplo: caneta, lápis, borracha\n\n` +
        `👤 Para falar com um vendedor, digite "vendedor"`;

      await message.reply(resposta);
    } else {
      await message.reply(
        'Desculpe, não encontrei esse produto. Digite "produtos" para ver nossa lista completa.'
      );
    }
  } catch (error) {
    console.error("Erro ao consultar produto:", error);
    await message.reply("Desculpe, ocorreu um erro ao buscar o produto.");
  }
}

// Lista de comandos específicos
const COMANDOS = {
  VER_CARRINHO: "ver carrinho",
  CONFIRMAR_PEDIDO: "confirmar pedido",
  CANCELAR_PEDIDO: "cancelar pedido",
  PRODUTOS: "produtos",
  CATALOGO: "catalogo",
  CARDAPIO: "cardápio",
  VENDEDOR: "vendedor",
  ATENDENTE: "atendente",
};

// Função para verificar se é um comando específico
function isComando(mensagem) {
  return Object.values(COMANDOS).includes(mensagem.toLowerCase().trim());
}

// Função para verificar se é um número válido de produto
function isNumeroProduto(mensagem) {
  return /^\d+$/.test(mensagem.trim());
}

// Função para adicionar produto ao carrinho (por número ou nome)
async function adicionarProduto(message) {
  try {
    const mensagem = message.body.toLowerCase().trim();
    const products = await Product.find({ active: true });
    let produtoSelecionado = null;

    // Tenta encontrar por número
    if (isNumeroProduto(mensagem)) {
      const numero = parseInt(mensagem);
      if (numero >= 1 && numero <= products.length) {
        produtoSelecionado = products[numero - 1];
      }
    }
    // Tenta encontrar por nome usando correspondência exata ou parcial
    else {
      produtoSelecionado = products.find(
        (p) =>
          p.name.toLowerCase().includes(mensagem) ||
          mensagem.includes(p.name.toLowerCase())
      );
    }

    if (!produtoSelecionado) {
      return false;
    }

    // Busca ou cria carrinho
    let carrinho = await Cart.findOne({ userId: message.from });
    if (!carrinho) {
      carrinho = new Cart({
        userId: message.from,
        items: [],
        total: 0,
      });
    }

    // Adiciona produto ao carrinho
    carrinho.items.push({
      product: produtoSelecionado._id,
      name: produtoSelecionado.name,
      price: produtoSelecionado.price,
      quantity: 1,
    });

    carrinho.total = carrinho.items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );
    await carrinho.save();

    // Monta resposta
    const resposta =
      `✅ *Produto adicionado ao carrinho*\n\n` +
      `*${produtoSelecionado.name}*\n` +
      `💰 Preço: R$ ${produtoSelecionado.price.toFixed(2)}\n\n` +
      `🛒 *Carrinho atual:*\n` +
      carrinho.items
        .map(
          (item, index) =>
            `${index + 1}. ${item.name} - R$ ${item.price.toFixed(2)}`
        )
        .join("\n") +
      `\n\n*Total: R$ ${carrinho.total.toFixed(2)}*\n\n` +
      `📝 Opções:\n` +
      `- Digite o número ou nome do produto para adicionar mais\n` +
      `- Digite "ver carrinho" para ver seus itens\n` +
      `- Digite "confirmar pedido" para finalizar\n` +
      `- Digite "cancelar pedido" para cancelar\n` +
      `- Digite "produtos" para ver o catálogo novamente`;

    await message.reply(resposta);
    return true;
  } catch (error) {
    console.error("Erro ao adicionar produto:", error);
    await message.reply(
      "Desculpe, ocorreu um erro ao adicionar o produto ao carrinho."
    );
    return false;
  }
}

// Função para ver carrinho
async function verCarrinho(message) {
  try {
    const carrinho = await Cart.findOne({ userId: message.from });

    if (!carrinho || carrinho.items.length === 0) {
      await message.reply(
        'Seu carrinho está vazio. Digite "produtos" para ver nosso catálogo.'
      );
      return;
    }

    let resposta = `🛒 *Seu Carrinho:*\n\n`;
    carrinho.items.forEach((item, index) => {
      resposta += `${index + 1}. ${item.name} - R$ ${item.price.toFixed(2)} x ${
        item.quantity
      }\n`;
    });

    resposta += `\n*Total: R$ ${carrinho.total.toFixed(2)}*\n\n`;
    resposta += `📝 Opções:\n`;
    resposta += `- Digite "confirmar pedido" para finalizar\n`;
    resposta += `- Digite "cancelar pedido" para cancelar\n`;
    resposta += `- Digite "produtos" para adicionar mais itens`;

    await message.reply(resposta);
  } catch (error) {
    console.error("Erro ao ver carrinho:", error);
    await message.reply(
      "Desculpe, ocorreu um erro ao visualizar seu carrinho."
    );
  }
}

// Função para escapar regex (já implementada anteriormente)
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Função para verificar proprietário
function ehProprietario(numero) {
  return numero === PROPRIETARIO_NUMERO;
}

// Função para verificar se passaram 24 horas desde a última interação
function passou24Horas(ultimaInteracao) {
  const agora = new Date();
  const diferenca = agora - new Date(ultimaInteracao);
  return diferenca >= 24 * 60 * 60 * 1000; // 24 horas em milissegundos
}

// Função para aguardar antes de enviar mensagens
async function aguardarAntesDeEnviar() {
  await setTimeout(2000); // Aguarda 2 segundos antes de enviar
}

// Adicionar lógica para saudação e inatividade
const usuariosUltimaInteracao = new Map(); // Armazena o timestamp da última interação por usuário
const usuariosTimers = new Map(); // Armazena os timers de inatividade por usuário

client.on("message", async (message) => {
  // Ignorar mensagens de grupo
  if (message.from.includes("@g.us")) return;

  const userId = message.from;
  const agora = new Date();

  // Verificar se passaram 24 horas desde a última interação
  if (
    !usuariosUltimaInteracao.has(userId) ||
    passou24Horas(usuariosUltimaInteracao.get(userId))
  ) {
    await aguardarAntesDeEnviar();
    await client.sendMessage(
      userId,
      "Olá! Bem-vindo novamente à nossa loja. Como posso ajudar você hoje?"
    );

    // Envia o menu de opções após a saudação
    const menu = new Buttons(
      "Escolha uma opção:",
      [
        { body: "Ver catálogo" },
        { body: "Ver carrinho" },
        { body: "Falar com atendente" },
        { body: "Sair" },
      ],
      "Menu Principal",
      "Por favor, selecione uma das opções abaixo:"
    );
    await client.sendMessage(userId, menu);
  }

  // Atualizar a última interação do usuário
  usuariosUltimaInteracao.set(userId, agora);

  // Cancelar qualquer timer de inatividade existente
  if (usuariosTimers.has(userId)) {
    clearTimeout(usuariosTimers.get(userId));
    usuariosTimers.delete(userId);
  }

  // Configurar um novo timer de inatividade de 5 minutos
  const timer = setTimeout(async () => {
    await aguardarAntesDeEnviar();
    await client.sendMessage(
      userId,
      "O atendimento será iniciado em breve. Por favor, aguarde."
    );
  }, 5 * 60 * 1000); // 5 minutos em milissegundos

  usuariosTimers.set(userId, timer);

  // Processar a mensagem normalmente (fluxo existente)
  try {
    const userId = message.from;
    let carrinho = await Cart.findOne({ userId });
    const msg = message.body ? message.body.trim() : "";

    // 1. Início do fluxo ou reset
    if (!carrinho) {
      carrinho = await Cart.create({
        userId,
        items: [],
        total: 0,
        state: "menu_principal",
      });

      // Envia o menu de opções na primeira mensagem do contato
      const menu = new Buttons(
        "Olá! Bem-vindo à nossa loja. O que deseja fazer?",
        [
          { body: "Ver catálogo" },
          { body: "Ver carrinho" },
          { body: "Falar com atendente" },
          { body: "Sair" },
        ],
        "Menu Principal",
        "Escolha uma opção:"
      );
      await client.sendMessage(message.from, menu);
      await Cart.updateOne({ userId }, { $set: { state: "aguardando_opcao" } });
      return;
    }

    // 2. Menu principal com botões
    if (carrinho.state === "menu_principal") {
      const menu = new Buttons(
        "Olá! Bem-vindo à nossa loja. O que deseja fazer?",
        [
          { body: "Ver catálogo" },
          { body: "Ver carrinho" },
          { body: "Falar com atendente" },
          { body: "Sair" },
        ],
        "Menu Principal",
        "Escolha uma opção:"
      );
      await client.sendMessage(message.from, menu);
      await Cart.updateOne({ userId }, { $set: { state: "aguardando_opcao" } });
      return;
    }

    // 3. Processa resposta do menu principal
    if (carrinho.state === "aguardando_opcao") {
      if (msg === "Ver catálogo") {
        // Mostra produtos com botões
        const products = await Product.find({ active: true });
        if (!products.length) {
          await message.reply("Nenhum produto cadastrado.");
          await Cart.updateOne(
            { userId },
            { $set: { state: "menu_principal" } }
          );
          return;
        }
        // Envia produtos em listas de até 3 botões por vez
        for (let i = 0; i < products.length; i += 3) {
          const chunk = products.slice(i, i + 3);
          const buttons = chunk.map((p) => ({ body: `Adicionar: ${p.name}` }));
          const texto = chunk
            .map((p, idx) => `*${p.name}*\n💰 R$ ${p.price.toFixed(2)}\n`)
            .join("\n");
          const lista = new Buttons(
            texto,
            buttons,
            "Produtos",
            "Escolha um produto para adicionar ao carrinho:"
          );
          await client.sendMessage(message.from, lista);
        }
        await Cart.updateOne(
          { userId },
          { $set: { state: "aguardando_produto" } }
        );
        return;
      } else if (msg === "Ver carrinho") {
        if (!carrinho.items.length) {
          await message.reply("Seu carrinho está vazio.");
          await Cart.updateOne(
            { userId },
            { $set: { state: "menu_principal" } }
          );
          return;
        }
        let texto = "🛒 *Seu Carrinho:*\n\n";
        carrinho.items.forEach((item, idx) => {
          texto += `${idx + 1}. ${item.name} - R$ ${item.price.toFixed(2)} x ${
            item.quantity
          }\n`;
        });
        texto += `\nTotal: R$ ${carrinho.total.toFixed(2)}`;
        const botoes = new Buttons(
          texto,
          [
            { body: "Finalizar compra" },
            { body: "Cancelar pedido" },
            { body: "Menu principal" },
          ],
          "Carrinho",
          "Escolha uma opção:"
        );
        await client.sendMessage(message.from, botoes);
        await Cart.updateOne(
          { userId },
          { $set: { state: "aguardando_carrinho" } }
        );
        return;
      } else if (msg === "Falar com atendente") {
        await message.reply("Um atendente irá falar com você em breve!");
        await Cart.updateOne({ userId }, { $set: { state: "menu_principal" } });
        return;
      } else if (msg === "Sair") {
        await message.reply("Obrigado por visitar nossa loja!");
        await Cart.deleteOne({ userId });
        return;
      } else {
        await message.reply("Escolha uma opção válida.");
        return;
      }
    }

    // 4. Adicionar produto ao carrinho por botão
    if (
      carrinho.state === "aguardando_produto" &&
      msg.startsWith("Adicionar: ")
    ) {
      const nomeProduto = msg.replace("Adicionar: ", "").trim();
      const produto = await Product.findOne({
        name: { $regex: new RegExp(`^${nomeProduto}$`, "i") },
      });
      if (produto) {
        let item = carrinho.items.find(
          (i) => i.product.toString() === produto._id.toString()
        );
        if (item) {
          item.quantity += 1;
        } else {
          carrinho.items.push({
            product: produto._id,
            name: produto.name,
            price: produto.price,
            quantity: 1,
          });
        }
        carrinho.total = carrinho.items.reduce(
          (t, item) => t + item.price * item.quantity,
          0
        );
        await carrinho.save();
        await message.reply(
          `Produto "${produto.name}" adicionado ao carrinho!`
        );
      } else {
        await message.reply("Produto não encontrado.");
      }
      await Cart.updateOne({ userId }, { $set: { state: "menu_principal" } });
      return;
    }

    // 5. Carrinho: finalizar compra, cancelar pedido, voltar ao menu
    if (carrinho.state === "aguardando_carrinho") {
      if (msg === "Finalizar compra") {
        // Verifica endereço
        if (!carrinho.address) {
          await message.reply("Por favor, envie seu endereço de entrega:");
          await Cart.updateOne(
            { userId },
            { $set: { state: "aguardando_endereco" } }
          );
          return;
        } else {
          const botoes = new Buttons(
            `Seu endereço atual é:\n${carrinho.address}\n\nDeseja confirmar ou cadastrar um novo?`,
            [
              { body: "Confirmar endereço" },
              { body: "Cadastrar novo endereço" },
            ],
            "Endereço de entrega",
            "Escolha uma opção:"
          );
          await client.sendMessage(message.from, botoes);
          await Cart.updateOne(
            { userId },
            { $set: { state: "confirmar_endereco" } }
          );
          return;
        }
      } else if (msg === "Cancelar pedido") {
        await Cart.deleteOne({ userId });
        await message.reply("Seu pedido foi cancelado.");
        return;
      } else if (msg === "Menu principal") {
        await Cart.updateOne({ userId }, { $set: { state: "menu_principal" } });
        return;
      } else {
        await message.reply("Escolha uma opção válida.");
        return;
      }
    }

    // 6. Cadastro de endereço
    if (carrinho.state === "aguardando_endereco") {
      if (msg.length < 5) {
        await message.reply(
          "Endereço muito curto. Por favor, envie o endereço completo."
        );
        return;
      }
      carrinho.address = msg;
      await carrinho.save();
      await message.reply("Endereço cadastrado com sucesso!");
      // Volta para confirmação de endereço
      const botoes = new Buttons(
        `Seu endereço atual é:\n${carrinho.address}\n\nDeseja confirmar ou cadastrar um novo?`,
        [{ body: "Confirmar endereço" }, { body: "Cadastrar novo endereço" }],
        "Endereço de entrega",
        "Escolha uma opção:"
      );
      await client.sendMessage(message.from, botoes);
      await Cart.updateOne(
        { userId },
        { $set: { state: "confirmar_endereco" } }
      );
      return;
    }

    // 7. Confirmação de endereço
    if (carrinho.state === "confirmar_endereco") {
      if (msg === "Confirmar endereço") {
        await message.reply(
          "Pedido finalizado! Em breve entraremos em contato para combinar a entrega e o pagamento."
        );
        await Cart.deleteOne({ userId });
        return;
      } else if (msg === "Cadastrar novo endereço") {
        await message.reply("Por favor, envie seu novo endereço de entrega:");
        await Cart.updateOne(
          { userId },
          { $set: { state: "aguardando_endereco" } }
        );
        return;
      } else {
        await message.reply("Escolha uma opção válida.");
        return;
      }
    }

    // 8. Se não reconheceu o fluxo, volta ao menu principal
    await Cart.updateOne({ userId }, { $set: { state: "menu_principal" } });
    await message.reply("Voltando ao menu principal...");
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
    await aguardarAntesDeEnviar();
    await client.sendMessage(
      userId,
      "Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente mais tarde."
    );
  }
});

// Evento para mensagens do proprietário
client.on("message", async (message) => {
  if (ehProprietario(message.from)) {
    // Verifica se a mensagem é uma resposta para algum cliente
    const match = message.body.match(/^@(\d+)/);
    if (match) {
      const numeroCliente = match[1] + "@c.us";
      const mensagemResposta = message.body.replace(/^@\d+\s*/, "");
      try {
        await client.sendMessage(numeroCliente, mensagemResposta);
      } catch (error) {
        console.error("Erro ao enviar resposta do proprietário:", error);
        await message.reply("Erro ao enviar mensagem para o cliente.");
      }
    }
  }
});

// Função para processar pedidos
async function createOrder(phoneNumber, productNames) {
  try {
    const products = await Product.find({
      name: { $in: productNames },
      active: true,
      stock: { $gt: 0 },
    });

    if (!products.length) {
      return "Desculpe, não encontrei os produtos solicitados ou estão fora de estoque.";
    }

    const order = new Order({
      phoneNumber,
      products: products.map((p) => ({
        product: p._id,
        quantity: 1,
        price: p.price,
      })),
      total: products.reduce((sum, p) => sum + p.price, 0),
    });

    await order.save();
    return `Pedido criado com sucesso! Total: R$ ${order.total.toFixed(2)}`;
  } catch (error) {
    console.error("Erro ao criar pedido:", error);
    return "Desculpe, houve um erro ao processar seu pedido.";
  }
}

// Função para gerenciar o carrinho
async function handleCart(client, message, text) {
  try {
    const userId = message.from;
    let cart = await Cart.findOne({ userId }).populate("items.product");

    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    // Comandos do carrinho
    if (text.includes("ver carrinho")) {
      await showCart(client, message, cart);
      return;
    }

    if (text.includes("finalizar compra")) {
      await finalizePurchase(client, message, cart);
      return;
    }

    if (text.includes("limpar carrinho")) {
      await clearCart(client, message, cart);
      return;
    }

    // Adicionar produto ao carrinho
    const quantity = extractQuantity(text) || 1;
    const productName = text.replace(/\d+/g, "").trim();

    const product = await Product.findOne({
      name: { $regex: productName, $options: "i" },
    });

    if (product) {
      cart.items.push({ product: product._id, quantity });
      await cart.save();

      await client.sendMessage(
        message.from,
        `✅ *Produto adicionado ao carrinho*\n\n` +
          `${product.name}\n` +
          `Quantidade: ${quantity}\n` +
          `Preço unitário: R$ ${product.price.toFixed(2)}\n\n` +
          `Digite:\n` +
          `📝 *ver carrinho* - para ver seus produtos\n` +
          `✨ *finalizar compra* - para concluir a compra\n` +
          `🗑️ *limpar carrinho* - para remover todos os itens`
      );
    }
  } catch (error) {
    console.error("Erro ao gerenciar carrinho:", error);
  }
}

// Função para mostrar o carrinho
async function showCart(client, message, cart) {
  try {
    if (!cart || cart.items.length === 0) {
      await client.sendMessage(
        message.from,
        "🛒 Seu carrinho está vazio!\n\n" +
          "Digite *produtos* para ver nosso catálogo."
      );
      return;
    }

    let total = 0;
    let cartText = "*🛒 Seu Carrinho:*\n\n";

    for (const item of cart.items) {
      const subtotal = item.product.price * item.quantity;
      total += subtotal;

      cartText +=
        `*${item.product.name}*\n` +
        `Quantidade: ${item.quantity}\n` +
        `Preço un.: R$ ${item.product.price.toFixed(2)}\n` +
        `Subtotal: R$ ${subtotal.toFixed(2)}\n\n`;
    }

    cartText +=
      `*Total: R$ ${total.toFixed(2)}*\n\n` +
      `Opções:\n` +
      `✨ Digite *finalizar compra* para concluir\n` +
      `🗑️ Digite *limpar carrinho* para remover tudo\n` +
      `📝 Digite *produtos* para continuar comprando`;

    await client.sendMessage(message.from, cartText);
  } catch (error) {
    console.error("Erro ao mostrar carrinho:", error);
  }
}

// Função para finalizar a compra
async function finalizePurchase(client, message, cart) {
  try {
    if (!cart || cart.items.length === 0) {
      await client.sendMessage(
        message.from,
        "🛒 Seu carrinho está vazio!\n\n" +
          "Digite *produtos* para ver nosso catálogo."
      );
      return;
    }

    let total = 0;
    let orderText = "*️ Resumo do Pedido:*\n\n";

    for (const item of cart.items) {
      const subtotal = item.product.price * item.quantity;
      total += subtotal;

      orderText +=
        `${item.quantity}x ${item.product.name}\n` +
        `R$ ${subtotal.toFixed(2)}\n\n`;
    }

    orderText +=
      `*Total: R$ ${total.toFixed(2)}*\n\n` +
      `Para concluir, preciso de:\n` +
      `- Seu nome completo\n` +
      `- Endereço de entrega\n` +
      `- Forma de pagamento preferida\n\n` +
      `💳 Formas de pagamento disponíveis:\n` +
      `- PIX\n` +
      `- Cartão de crédito\n` +
      `- Dinheiro na entrega`;

    await client.sendMessage(message.from, orderText);

    // Aqui você pode adicionar botões ou links para pagamento
    // Exemplo com link do WhatsApp:
    const paymentLink = `https://wa.me/seu_numero?text=Olá! Quero finalizar minha compra de R$ ${total.toFixed(
      2
    )}`;
    await client.sendMessage(
      message.from,
      `Clique aqui para finalizar o pagamento:\n${paymentLink}`
    );
  } catch (error) {
    console.error("Erro ao finalizar compra:", error);
  }
}

// Função para limpar o carrinho
async function clearCart(client, message, cart) {
  try {
    await Cart.deleteOne({ userId: message.from });
    await client.sendMessage(
      message.from,
      "🗑️ Carrinho limpo com sucesso!\n\n" +
        "Digite *produtos* para ver nosso catálogo."
    );
  } catch (error) {
    console.error("Erro ao limpar carrinho:", error);
  }
}

// Função auxiliar para extrair quantidade do texto
function extractQuantity(text) {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0]) : 1;
}

// Função para processar pedidos específicos
async function handleOrder(client, message, text) {
  try {
    const products = await Product.find({ active: true });
    let product;

    // Verificar se é um número
    if (!isNaN(text)) {
      const index = parseInt(text) - 1;
      if (index >= 0 && index < products.length) {
        product = products[index];
      }
    } else {
      // Procurar por nome
      product = products.find(
        (p) =>
          p.name.toLowerCase().includes(text.toLowerCase()) ||
          (p.code && p.code.includes(text))
      );
    }

    if (product) {
      const orderText =
        `*Produto Encontrado:*\n\n` +
        `*${product.name}*\n` +
        `💰 Preço: R$ ${product.price.toFixed(2)}\n` +
        `📦 Código: ${product.code || "N/A"}\n` +
        `📏 Unidade: ${product.unit}\n\n` +
        `Para fazer o pedido, por favor me informe:\n` +
        `- Quantidade desejada\n` +
        `- Seu nome completo\n` +
        `- Endereço de entrega`;

      await client.sendMessage(message.from, orderText);
    } else {
      await client.sendMessage(
        message.from,
        "Desculpe, não encontrei esse produto. Digite *produtos* para ver nosso catálogo completo."
      );
    }
  } catch (error) {
    console.error("Erro ao processar pedido:", error);
  }
}

// Função para listar produtos
async function listProducts(message) {
  try {
    const products = await Product.find({ active: true });

    if (!products || products.length === 0) {
      await message.reply("Desculpe, não encontrei produtos cadastrados.");
      return;
    }

    const saudacao = getSaudacao();
    let catalogMessage = `${saudacao}! 🛍️ *Catálogo de Produtos*\n\n`;

    products.forEach((product, index) => {
      catalogMessage += `*${index + 1}. ${product.name}*\n`;
      catalogMessage += `💰 Preço: R$ ${product.price.toFixed(2)}\n`;
      if (product.code) {
        catalogMessage += `📦 Código: ${product.code}\n`;
      }
      catalogMessage += "\n";
    });

    catalogMessage +=
      "\n📝 Para comprar, digite o número ou nome do produto desejado\n";
    catalogMessage += '👤 Para falar com um vendedor, digite "vendedor"';

    await message.reply(catalogMessage);
  } catch (error) {
    console.error("Erro ao listar produtos:", error);
    await message.reply("Desculpe, ocorreu um erro ao listar os produtos.");
  }
}

// Verificar se o MongoDB está conectado
mongoose.connection.on("connected", () => {
  console.log("MongoDB conectado com sucesso");
});

mongoose.connection.on("error", (err) => {
  console.error("Erro na conexão com MongoDB:", err);
});

// Configuração do Express
const app = express();

// Middlewares de segurança
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "10mb" }));

// Conectar ao banco de dados
connectDB();

// Rotas
app.use("/api", require("./routes/productRoutes"));
app.use("/api", require("./routes/orderRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

// Métricas Prometheus
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});

// Middleware de erro
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
});

// Tratamento de erros não capturados
process.on("unhandledRejection", (error) => {
  logger.error("Erro não tratado:", error);
});

process.on("uncaughtException", (error) => {
  logger.error("Exceção não capturada:", error);
  process.exit(1);
});

// Adicionar tratamento de erro para Redis
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  retryStrategy: function (times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  console.log("Erro de conexão com Redis:", err.message);
  // O sistema pode continuar funcionando sem Redis, apenas com performance reduzida
});

// Melhorar a conexão com MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log("MongoDB conectado com sucesso");
  })
  .catch((err) => {
    console.log("Erro ao conectar com MongoDB:", err.message);
  });
