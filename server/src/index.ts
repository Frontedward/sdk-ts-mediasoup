import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { logger } from './logger';
import { RoomManager } from './room-manager';
import { SignalingHandler } from './signaling-handler';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();
const signalingHandler = new SignalingHandler(roomManager);

// Обработка WebSocket соединений
io.on('connection', (socket) => {
  logger.info(`Новое подключение: ${socket.id}`);

  // Обработка сигналинг-сообщений
  socket.on('message', async (message) => {
    try {
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