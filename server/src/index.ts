import { Request, Response } from 'express';
const express = require('express');
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { logger } from './logger';
import { SignalingHandler } from './signaling-handler';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket']
});

const signalingHandler = new SignalingHandler();

// Инициализация mediasoup
(async () => {
  try {
    await signalingHandler.init();
    logger.info('Mediasoup initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize mediasoup:', error);
    process.exit(1);
  }
})();

// Базовый маршрут для проверки работы сервера
app.get('/', (_: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Обработка WebSocket соединений
io.on('connection', (socket) => {
  logger.info(`Новое подключение: ${socket.id}`);

  // Обработка сигналинг-сообщений
  socket.on('message', async (message) => {
    try {
      logger.info(`Получено сообщение от ${socket.id}:`, message);
      await signalingHandler.handleMessage(socket, message);
    } catch (error) {
      logger.error('Ошибка обработки сообщения:', error);
      socket.emit('message', {
        type: 'error',
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      });
    }
  });

  // Обработка отключения
  socket.on('disconnect', () => {
    logger.info(`Отключение: ${socket.id}`);
    signalingHandler.handleDisconnect(socket);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info(`Сервер запущен на порту ${PORT}`);
}); 