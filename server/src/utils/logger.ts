import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'rehls' },
  transports: [
    new winston.transports.Console(),
  ],
});