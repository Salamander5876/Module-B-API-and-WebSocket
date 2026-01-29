# Interactive Whiteboard API & WebSocket Server

Серверная часть приложения для совместной работы над интерактивными досками (Whiteboard). Реализована на **Node.js + Express + Socket.io + SQLite**.

## 📋 Описание функционала

* **REST API** для регистрации, авторизации, управления досками, лайками и шерингом.
* **WebSocket (Socket.io)** для синхронизации холста в реальном времени.
* **Валидация:** Проверка границ холста (1600x900) на сервере.
* **Фокус:** Система блокировки объектов (Locking), предотвращающая одновременное редактирование одного элемента разными пользователями.

---

## 🚀 Установка и Запуск

1.  **Установка зависимостей:**
    ```bash
    npm install
    ```

2.  **Запуск сервера:**
    ```bash
    node index.js
    ```
    Сервер запустится по адресу: `http://localhost:3000`

---

## 🔑 Обязательные HTTP Заголовки (Headers)

В этом API используются строгие правила валидации заголовков.
**Любой HTTP запрос** должен содержать как минимум первые два заголовка.

| Заголовок | Значение | Где обязателен? | Описание |
| :--- | :--- | :--- | :--- |
| **Content-Type** | `application/json` | **Все запросы** | Указывает формат данных. |
| **ClientId** | `<Ваш_Логин>` | **Все запросы** | Ваш идентификатор (по ТЗ). Например: `IvanDev`. |
| **Authorization** | `Bearer <Token>` | **Приватные запросы** | Токен, полученный при логине. Нужен для действий внутри личного кабинета. |

> ⚠️ **Важно:** Если вы не передадите заголовок `ClientId`, сервер вернет ошибку `400 Missing ClientId header`.

---

## 📚 REST API Документация

### 👤 1. Аутентификация

#### Регистрация
* **Метод:** `POST`
* **URL:** `/api/auth/register`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
* **Body:**
    ```json
    {
      "email": "user@example.com",
      "name": "Alex",
      "password": "Password123!"
    }
    ```

#### Вход (Логин)
* **Метод:** `POST`
* **URL:** `/api/auth/login`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
* **Body:**
    ```json
    {
      "email": "user@example.com",
      "password": "Password123!"
    }
    ```
* **Ответ:** `{ "token": "...", "user": {...} }`. Сохраните `token` для следующих запросов.

---

### 📋 2. Управление досками (Dashboard)

#### Получить список моих досок
* **Метод:** `GET`
* **URL:** `/api/boards`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
    * `Authorization: Bearer <Ваш_Токен>`

#### Создать новую доску
* **Метод:** `POST`
* **URL:** `/api/boards`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
    * `Authorization: Bearer <Ваш_Токен>`
* **Body:**
    ```json
    { "title": "My New Project" }
    ```

#### Получить полную информацию о доске (для входа на холст)
* **Метод:** `GET`
* **URL:** `/api/boards/:id`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
    * `Authorization: Bearer <Ваш_Токен>`
* **Ответ:** Возвращает объект доски и массив `elements` (JSON с объектами холста).

---

### 🌐 3. Публичный доступ и Социальное

#### Список всех публичных досок
* **Метод:** `GET`
* **URL:** `/api/boards/public?sort=likes`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
* **Authorization:** НЕ требуется.

#### Просмотр публичной доски (Гостевой доступ)
* **Метод:** `GET`
* **URL:** `/board/:hash`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
* **Authorization:** НЕ требуется.
* **Описание:** Доступ по уникальному хешу (поле `hash` из объекта доски).

#### Предоставить доступ другу (Share)
* **Метод:** `POST`
* **URL:** `/api/boards/:id/share`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
    * `Authorization: Bearer <Ваш_Токен>`
* **Body:**
    ```json
    { "email": "friend@example.com" }
    ```

#### Поставить лайк
* **Метод:** `POST`
* **URL:** `/api/boards/:id/like`
* **Headers:**
    * `Content-Type: application/json`
    * `ClientId: <Ваш_Логин>`
    * `Authorization: Bearer <Ваш_Токен>`

---

## ⚡ WebSocket API (Real-time)

**URL:** `ws://localhost:3000`

### Подключение (Handshake)
При подключении необходимо передать токен авторизации внутри объекта `auth`.

```javascript
const socket = io("http://localhost:3000", {
  auth: {
    token: "ВАШ_JWT_ТОКЕН" // Если не передать, сервер присвоит имя "Guest"
  }
});