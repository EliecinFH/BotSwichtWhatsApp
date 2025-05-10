const fs = require('fs');
const pdf = require('pdf-parse');
const Product = require('../models/Product');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const path = require('path');

// Função para extrair imagens (salva como arquivos temporários)
async function extractImagesFromPDF(pdfPath, outputDir) {
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    const images = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const ops = await page.getOperatorList();
        const objs = page.objs;

        for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject) {
                const imgName = ops.argsArray[i][0];
                const img = objs.get(imgName);
                if (img && img.data) {
                    const imgPath = path.join(outputDir, `img_${pageNum}_${i}.png`);
                    fs.writeFileSync(imgPath, Buffer.from(img.data));
                    images.push(imgPath);
                }
            }
        }
    }
    return images;
}

async function importProductsFromPDF(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);

    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);

    let produtosImportados = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Procura por linhas de preço
        if (line.match(/^R\$ ?/)) {
            // Pega nome e unidade das linhas anteriores
            let name = lines[i - 2] || '';
            let unidade = lines[i - 1] || '';
            let priceStr = line.replace('R$', '').replace('PROMO', '').replace(/\s/g, '');

            // Se houver dois preços, pega o maior
            let price = 0;
            if (priceStr.includes('/')) {
                const [p1, p2] = priceStr.split('/').map(p => parseFloat(p.replace(',', '.')));
                price = Math.max(p1, p2);
            } else {
                price = parseFloat(priceStr.replace(',', '.'));
            }

            // Tenta extrair o código de barras (linha anterior ao nome, se for numérico grande)
            let code = null;
            if (lines[i - 3] && /^\d{8,}$/.test(lines[i - 3])) {
                code = lines[i - 3];
            }

            // Monta o objeto de update
            let update = {
                name,
                price,
                active: true,
                unidade
            };
            if (code) {
                update.code = code;
            }

            // Atualiza ou cria produto (prioriza code, senão name)
            try {
                await Product.findOneAndUpdate(
                    code ? { code } : { name },
                    { $inc: { stock: 1 }, $set: update },
                    { upsert: true, new: true }
                );
                produtosImportados++;
                console.log(`Produto importado: ${name} | Unidade: ${unidade} | Preço: ${price} | Código: ${code || 'N/A'}`);
            } catch (err) {
                console.error(`Erro ao importar produto: ${name} | Erro: ${err.message}`);
            }
        }
    }
    return `Importação do PDF concluída! Produtos importados: ${produtosImportados}`;
}

module.exports = { importProductsFromPDF }; 