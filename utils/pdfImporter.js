const fs = require('fs');
const pdfParse = require('pdf-parse');
const Product = require('../models/Product');

async function extractTableData(pdfText) {
    const regex = /(\d{12})?\s*([A-ZÇÃÉÍÓÚÂÊÎÔÛÀÈÌÒÙÄËÏÖÜ\s\/]+?)\s+UNID\s+R\$\s*([\d,.]+)/g;
    const products = [];
    let match;

    while ((match = regex.exec(pdfText)) !== null) {
        const [, code, name, price] = match;
        products.push({
            code: code || '',
            name: name.trim(),
            unit: 'UNID',
            price: parseFloat(price.replace(',', '.'))
        });
    }

    return products;
}

async function importProductsFromPDF(pdfPath) {
    try {
        if (!fs.existsSync(pdfPath)) {
            throw new Error('Arquivo PDF não encontrado');
        }

        const dataBuffer = fs.readFileSync(pdfPath);
        const pdfData = await pdfParse(dataBuffer);
        
        const products = await extractTableData(pdfData.text);
        if (!products || products.length === 0) {
            throw new Error('Nenhum produto encontrado no PDF');
        }

        const savedProducts = await Promise.all(
            products.map(async (product) => {
                const newProduct = new Product(product);
                return await newProduct.save();
            })
        );

        console.log(`${savedProducts.length} produtos importados com sucesso`);
        return savedProducts;
    } catch (error) {
        console.error('Erro ao importar produtos:', error);
        throw error;
    }
}

module.exports = {
    importProductsFromPDF
}; 