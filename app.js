const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const { MessageMedia } = require("whatsapp-web.js");
const {
  importProductsFromPDF,
  extractProductsFromPDF,
} = require("./utils/pdfImporter");
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
const messageHandler = require('./services/messageHandler');
const { ehProprietario, validarNumeroTelefone } = require('./utils/ownerUtils');
const config = require('./config/config');
const { createDirectories } = require('./utils/setupDirs');

// Importação dos modelos
const Conversation = require("./models/Conversation");
const Product = require("./models/Product");
const Order = require("./models/Order");
const cache = require("./utils/cache");

// Conexão com MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    logger.info(`MongoDB Conectado: ${conn.connection.host}`);

    // Implementar cache do mongoose
    mongoose.set("cache", true);
  } catch (error) {
    logger.error(`Erro: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

// Usar a configuração do arquivo de config
const openai = require('./config/openai');

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

// Antes de iniciar o bot, adicione:
createDirectories();

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
const PROPRIETARIO_NUMERO = "557196177635@c.us";

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
    const mensagemEncaminhada = `📩 Nova mensagem de: ${message.from}\n\n${message.body}`;
    await client.sendMessage(PROPRIETARIO_NUMERO, mensagemEncaminhada);
  } catch (error) {
    console.error("Erro ao encaminhar mensagem:", error);
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
      resposta += `${index + 1}. ${item.name} - R$ ${item.price.toFixed(2)}\n`;
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

// Atualização do evento de mensagem
client.on("message", async (message) => {
  // Ignorar mensagens de grupo
  if (message.from.includes('@g.us')) return;

  try {
    // Verificar primeiro se é o proprietário
    if (ehProprietario(message.from)) {
      const msg = message.body ? message.body.trim() : '';
      const match = msg.match(/^@(\d+)/);
      if (match) {
        const numeroCliente = validarNumeroTelefone(match[1]);
        const mensagemResposta = msg.replace(/^@\d+\s*/, '');
        try {
          await client.sendMessage(numeroCliente, mensagemResposta);
          await message.reply('✅ Mensagem enviada com sucesso!');
        } catch (error) {
          console.error('Erro ao enviar resposta do proprietário:', error);
          await message.reply('❌ Erro ao enviar mensagem para o cliente.');
        }
        return;
      }
      // Se não for uma resposta para cliente, continua o fluxo normal
    }

    const userId = message.from;
    let carrinho = await Cart.findOne({ userId });
    const msg = message.body ? message.body.trim() : '';

    // 1. Início do fluxo ou reset
    if (!carrinho) {
      carrinho = await Cart.create({ userId, items: [], total: 0, state: 'menu_principal' });

      // Envia o menu de opções na primeira mensagem do contato
      const menu = new Buttons(
        'Olá! Bem-vindo à nossa loja. O que deseja fazer?',
        [
          { body: 'Ver catálogo' },
          { body: 'Ver carrinho' },
          { body: 'Falar com atendente' },
          { body: 'Sair' }
        ],
        'Menu Principal',
        'Escolha uma opção:'
      );
      await client.sendMessage(message.from, menu);
      await Cart.updateOne({ userId }, { $set: { state: 'aguardando_opcao' } });
      return;
    }

    // Se não for comando nem produto, processa como mensagem normal
    if (!isComando(msg) && 
        !(isNumeroProduto(msg) || 
        await Product.exists({ name: { $regex: msg, $options: "i" } }))) {
      
      try {
        // Processar com IA e gerar resposta
        const aiResponse = await processMessageWithAI(msg, userId);
        await message.reply(aiResponse);

        // Enviar menu de ajuda após a resposta
        setTimeout(async () => {
          await message.reply(
            "Como posso ajudar?\n\n" +
            "Comandos disponíveis:\n" +
            "- *produtos* - Ver nosso catálogo\n" +
            "- *carrinho* - Ver seu carrinho\n" +
            "- *vendedor* - Falar com atendente\n"
          );
        }, config.TEMPO_ESPERA_MENU);
      } catch (error) {
        console.error('Erro ao processar mensagem com IA:', error);
        await message.reply('Desculpe, não entendi. Como posso ajudar com nossos produtos?');
      }
      return;
    }

    // Processa apenas se for um comando específico
    if (isComando(msg)) {
      switch (msg) {
        case COMANDOS.VER_CARRINHO:
          await verCarrinho(message);
          return;
        case COMANDOS.CONFIRMAR_PEDIDO:
          await confirmarPedido(message);
          return;
        case COMANDOS.CANCELAR_PEDIDO:
          await Cart.deleteOne({ userId: message.from });
          await message.reply(
            'Pedido cancelado. Digite "produtos" para ver nosso catálogo.'
          );
          return;
        case COMANDOS.PRODUTOS:
        case COMANDOS.CATALOGO:
        case COMANDOS.CARDAPIO:
          await listProducts(message);
          return;
        case COMANDOS.VENDEDOR:
        case COMANDOS.ATENDENTE:
          await iniciarAtendimentoHumano(message);
          return;
      }
    }

    // Verifica se é uma tentativa de adicionar produto
    if (
      isNumeroProduto(msg) ||
      (await Product.exists({
        name: { $regex: msg, $options: "i" },
      }))
    ) {
      await adicionarProduto(message);
      return;
    }

  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    await message.reply('Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente mais tarde.');
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
    const paymentLink = `https://wa.me/5574988169498?text=Olá! Quero finalizar minha compra de R$ ${total.toFixed(
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
