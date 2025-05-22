import * as winston from 'winston';
const { format, transports, createLogger } = winston;

// Настройка форматирования логов
const logFormat = format.combine(
  format.timestamp(),
  format.colorize(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    return `${timestamp} [${level}]: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
    }`;
  })
);

// Создание логгера
export const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    // Вывод в консоль
    new transports.Console(),
    // Запись в файл
    new transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new transports.File({
      filename: 'logs/combined.log'
    })
  ]
}); 