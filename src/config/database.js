const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
        });

        mongoose.set('cache', true);
        logger.info(`MongoDB Conectado: ${conn.connection.host}`);
    } catch (error) {
        logger.error(`Erro na conexão com MongoDB: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;