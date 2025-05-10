const fs = require('fs');
const xml2js = require('xml2js');
const Product = require('../models/Product');

async function importProductsFromXML(xmlPath) {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);

    // Ajuste conforme a estrutura do seu XML!
    // Exemplo: <produtos><produto><nome>...</nome><preco>...</preco><quantidade>...</quantidade></produto></produtos>
    const produtos = result.produtos.produto;
    for (const prod of produtos) {
        const name = prod.nome[0];
        const price = parseFloat(prod.preco[0].replace(',', '.'));
        const quantity = parseInt(prod.quantidade[0], 10);

        // Atualiza ou cria produto, somando a quantidade
        await Product.findOneAndUpdate(
            { name },
            { $set: { name, price, active: true }, $inc: { stock: quantity } },
            { upsert: true, new: true }
        );
    }
    return 'Importação do XML concluída!';
}

module.exports = { importProductsFromXML };
