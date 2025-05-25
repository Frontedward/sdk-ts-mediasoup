# SDK для видеозвонков на базе Mediasoup

Этот проект представляет собой SDK для клиентских приложений, который обеспечивает подключение к медиа-серверу на базе Mediasoup и предоставляет удобные абстракции для работы с видеозвонками.

## Основные возможности

- Подключение к видеозвонкам через WebSocket или Mock режим
- Управление медиа-транспортами (send/recv)
- Работа с аудио и видео потоками
- Поддержка симулкаста для видео
- Асинхронная очередь событий
- Типизированные события
- Интеграция с MobX для управления состоянием
- Автоматическое переподключение при разрыве соединения
- Mock режим для демонстрации без сервера
- Синхронизация между вкладками через localStorage

## Требования

- Node.js 18+
- npm или yarn
- Современный браузер с поддержкой WebRTC

## Установка

```bash
npm install
```

## Разработка

Для запуска проекта в режиме разработки:

```bash
npm run dev
```

Для сборки проекта:

```bash
npm run build
```

Для запуска тестов:

```bash
npm test
```

## Структура проекта

```
src/
  ├── sdk/                    # Основной код SDK
  │   ├── events/            # Обработка событий
  │   ├── media/             # Работа с медиа
  │   ├── signaling/         # Сигналинг
  │   ├── store/             # MobX store
  │   └── types.ts           # Типы и интерфейсы
  ├── demo/                  # Демо-приложение
  └── __tests__/            # Тесты
```

## Использование SDK

### Mock режим (для демонстрации)

```typescript
import { VideoCallClient } from './sdk/video-call-client';
import { MockSignalingChannel } from './sdk/signaling/signaling-channel';

// Создание клиента в mock режиме
const client = new VideoCallClient({
  signalingChannel: new MockSignalingChannel(),
  autoReconnect: true,
  useSimulcast: false
});

// Подписка на события
client.on('connectionStatusChanged', (status) => {
  console.log('Статус соединения:', status);
});

client.on('participantJoined', (participant) => {
  console.log('Участник присоединился:', participant);
});

// Подключение к звонку
try {
  await client.joinCall('room-123', 'user-456', 'Иван Иванов');
  
  // Включение/выключение видео
  await client.enableVideo(true);
  
  // Включение/выключение аудио
  await client.enableAudio(true);
  
} catch (error) {
  console.error('Ошибка подключения:', error);
}

// Отключение от звонка
await client.leaveCall();
```

### Реальный режим (с сервером)

```typescript
import { VideoCallClient } from './sdk/video-call-client';

// Создание клиента с реальным сервером
const client = new VideoCallClient({
  signalingUrl: 'ws://localhost:3000',
  autoReconnect: true,
  useSimulcast: true
});

// Остальное использование аналогично mock режиму
```

## Архитектурные особенности

1. **Асинхронная очередь событий**
   - Гарантирует последовательную обработку сигналинг-сообщений
   - Предотвращает гонки состояний при создании транспортов

2. **Типизированные события**
   - Строгая типизация всех событий SDK
   - Автодополнение в IDE
   - Предотвращение ошибок при работе с событиями

3. **MobX интеграция**
   - Реактивное управление состоянием
   - Автоматическое обновление UI при изменении состояния
   - Предсказуемые обновления состояния

4. **Обработка ошибок**
   - Детальная типизация ошибок
   - Автоматическое восстановление при сбоях
   - Информативные сообщения об ошибках

## Особенности реализации

### Mock режим
- Эмулирует работу сигнального сервера без реального подключения
- Использует localStorage для синхронизации между вкладками браузера
- Поддерживает множественные подключения в одну комнату
- Показывает реальное видео для локального пользователя
- Отображает красивые заглушки для удаленных участников

### Адаптивный интерфейс
- Камера отключена по умолчанию при запуске
- Адаптивные кнопки управления для мобильных устройств
- Современный дизайн с использованием Tailwind CSS

### Архитектура
- Типизированные события с TypeScript
- Реактивное управление состоянием с MobX
- Асинхронная очередь для обработки сигнальных сообщений
- Модульная структура для легкого расширения

## Демо приложение

Проект включает полнофункциональное демо приложение, которое демонстрирует:

- Подключение к видеозвонку
- Управление камерой и микрофоном
- Отображение участников
- Адаптивный интерфейс
- Работу в mock режиме

### Запуск демо

1. Установите зависимости: `npm install`
2. Запустите проект: `npm run dev`
3. Откройте браузер по адресу `http://localhost:5173`
4. Введите данные для подключения и нажмите "Присоединиться"

### Тестирование множественных пользователей

Для тестирования работы с несколькими пользователями:

1. Откройте несколько вкладок браузера
2. В каждой вкладке введите одинаковый ID комнаты
3. Используйте разные ID пользователей
4. Подключитесь к звонку в каждой вкладке

Благодаря localStorage синхронизации, все участники будут видеть друг друга.

## Планы по улучшению

1. **Масштабируемость**
   - Поддержка нескольких медиа-серверов
   - Балансировка нагрузки
   - Механизм failover

2. **Устойчивость**
   - Улучшенная обработка сетевых сбоев
   - Автоматическое переподключение
   - Сохранение состояния при переподключении

3. **Производительность**
   - Оптимизация использования ресурсов
   - Адаптивное качество видео
   - Эффективное управление памятью

## Технические детали

### Используемые технологии

- **TypeScript** - строгая типизация
- **React** - пользовательский интерфейс
- **MobX** - управление состоянием
- **Mediasoup Client** - WebRTC клиент
- **Tailwind CSS** - стилизация
- **Vite** - сборка проекта

### Поддерживаемые браузеры

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### Ограничения Mock режима

- Каждая вкладка может получить доступ только к своей камере
- Удаленные участники отображаются как заглушки
- Реальная передача видео/аудио между участниками невозможна
- Для полной функциональности требуется настоящий Mediasoup сервер

## Архитектурные улучшения для продакшена

### 1. Масштабируемость

**Множественные медиа-серверы:**
```typescript
interface ServerCluster {
  servers: MediaServer[];
  loadBalancer: LoadBalancer;
  healthChecker: HealthChecker;
}

class LoadBalancer {
  selectServer(criteria: SelectionCriteria): MediaServer {
    // Алгоритмы балансировки: round-robin, least-connections, geographic
  }
}
```

**Горизонтальное масштабирование:**
- Использование Redis для синхронизации состояния между серверами
- Микросервисная архитектура с отдельными сервисами для сигналинга и медиа
- Автоматическое масштабирование на основе нагрузки

### 2. Устойчивость и Failover

**Автоматическое переподключение:**
```typescript
class ReconnectionManager {
  private reconnectAttempts = 0;
  private maxAttempts = 5;
  private backoffStrategy = new ExponentialBackoff();
  
  async handleDisconnection() {
    while (this.reconnectAttempts < this.maxAttempts) {
      await this.backoffStrategy.wait(this.reconnectAttempts);
      if (await this.attemptReconnection()) {
        break;
      }
      this.reconnectAttempts++;
    }
  }
}
```

**Failover механизм:**
- Мониторинг здоровья серверов
- Автоматическое переключение на резервные серверы
- Сохранение состояния сессии для бесшовного переключения

### 3. WebRTC Data Channels

**Дополнительная сигнализация через DataChannels:**
```typescript
class DataChannelSignaling {
  private dataChannel: RTCDataChannel;
  
  // Отправка метаданных минуя сигнальный сервер
  sendMetadata(data: ParticipantMetadata) {
    this.dataChannel.send(JSON.stringify(data));
  }
  
  // Peer-to-peer обмен состоянием
  syncState(state: RoomState) {
    this.broadcastToDataChannels(state);
  }
}
```

### 4. Адаптивное качество

**Динамическое управление качеством:**
```typescript
class QualityManager {
  adjustQuality(networkConditions: NetworkStats) {
    const optimalSettings = this.calculateOptimalSettings(networkConditions);
    this.applyVideoConstraints(optimalSettings);
  }
  
  private calculateOptimalSettings(stats: NetworkStats): VideoConstraints {
    // Алгоритм адаптации на основе пропускной способности и задержки
  }
}
```

### 5. Мониторинг и Аналитика

**Метрики производительности:**
```typescript
interface SDKMetrics {
  connectionLatency: number;
  packetLoss: number;
  videoQuality: QualityMetrics;
  audioQuality: QualityMetrics;
  reconnectionCount: number;
}

class MetricsCollector {
  collectMetrics(): SDKMetrics;
  sendToAnalytics(metrics: SDKMetrics): void;
}
```

### 6. Безопасность

**Аутентификация и авторизация:**
```typescript
interface SecurityManager {
  authenticateUser(token: string): Promise<UserCredentials>;
  authorizeRoomAccess(userId: string, roomId: string): Promise<boolean>;
  encryptSignaling(message: SignalingMessage): EncryptedMessage;
}
```

### 7. Кэширование и оптимизация

**Интеллектуальное кэширование:**
- Кэширование RTP capabilities
- Переиспользование транспортов
- Оптимизация создания/уничтожения producers/consumers

### 8. Расширенная диагностика

**Детальная диагностика проблем:**
```typescript
class DiagnosticManager {
  runNetworkDiagnostics(): NetworkDiagnostics;
  analyzeMediaQuality(): QualityReport;
  generateTroubleshootingReport(): TroubleshootingReport;
}
```

Эти улучшения обеспечат enterprise-уровень надежности, производительности и масштабируемости SDK.