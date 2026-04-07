import pino from 'pino';
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
        paths: [
            '*.apiKey',
            '*.api_key',
            '*.token',
            '*.secret',
            '*.password',
            '*.authorization',
            'headers.authorization',
            'req.headers.authorization',
            'env.ANTHROPIC_API_KEY',
            'env.LLM_API_KEY',
            'env.MINIMAX_API_KEY',
            'env.TIX_PERPLEXITY_API_KEY',
            'env.TIX_SERPER_API_KEY',
            'env.TIX_BRAVE_API_KEY',
            'env.TIX_JINA_API_KEY',
            'env.GITHUB_TOKEN',
            'env.GH_TOKEN',
        ],
        censor: '[REDACTED]',
    },
    transport: { target: 'pino-pretty', options: { colorize: true } },
});
// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
});
//# sourceMappingURL=logger.js.map