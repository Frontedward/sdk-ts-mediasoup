FROM node:18-alpine

WORKDIR /app

# Установка зависимостей для mediasoup
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    linux-headers

# Копирование package.json и package-lock.json
COPY package*.json ./

# Установка зависимостей
RUN npm ci

# Копирование исходного кода
COPY . .

# Сборка TypeScript
RUN npm run build

# Создание директории для логов
RUN mkdir -p logs

# Открытие портов
EXPOSE 3000

# Запуск сервера
CMD ["npm", "start"] 