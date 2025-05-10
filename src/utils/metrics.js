const prometheus = require('prom-client');

const register = new prometheus.Registry();
prometheus.collectDefaultMetrics({ register });

const httpRequestDuration = new prometheus.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5]
});

const botMessagesTotal = new prometheus.Counter({
    name: 'bot_messages_total',
    help: 'Total de mensagens processadas pelo bot',
    labelNames: ['type']
});

const activeChats = new prometheus.Gauge({
    name: 'active_chats',
    help: 'Número de chats ativos'
});

register.registerMetric(httpRequestDuration);
register.registerMetric(botMessagesTotal);
register.registerMetric(activeChats);

module.exports = {
    register,
    httpRequestDuration,
    botMessagesTotal,
    activeChats,
    increment: (metric, labels = {}) => {
        if (botMessagesTotal.has(labels)) {
            botMessagesTotal.inc(labels);
        }
    }
};