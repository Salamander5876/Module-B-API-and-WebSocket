Вот готовый файл `README.md` для твоего проекта. Он содержит инструкции по запуску, описание архитектуры и подробную документацию по API и WebSocket событиям.

Сохрани этот текст в файл `README.md` в корне папки сервера.

---

# Interactive Whiteboard API & WebSocket Server

Серверная часть приложения для совместной работы над интерактивными досками (Whiteboard). Реализована на **Node.js + Express + Socket.io + SQLite**.

## 📋 Описание функционала

* **REST API** для регистрации, авторизации, управления досками, лайками и шерингом.
* **WebSocket (Socket.io)** для синхронизации холста в реальном времени.
* **Валидация:** Проверка границ холста (1600x900) на сервере.
* **Фокус:** Система блокировки объектов (Locking), предотвращающая одновременное редактирование одного элемента разными пользователями.

---

## 🚀 Установка и Запуск

### 1. Требования

* Node.js (v14 или выше)
* NPM

### 2. Установка зависимостей

Перейдите в папку с сервером и выполните:

```bash
npm install

```

*Если вы создаете проект с нуля, убедитесь, что установлены пакеты:*
`express`, `socket.io`, `sqlite3`, `bcryptjs`, `jsonwebtoken`, `cors`, `uuid`.

### 3. Запуск сервера

```bash
node index.js

```

Сервер запустится по адресу: `http://localhost:3000`
База данных `database.sqlite` будет создана автоматически при первом запуске.

---

## 🔑 Правила запросов (Headers)

Для **всех** HTTP запросов необходимо передавать следующие заголовки:

1. **Content-Type:** `application/json`
2. **ClientId:** `<Ваш_Логин>` (Обязательно по ТЗ, например: `IvanDev`)

Для **защищенных** маршрутов (все, кроме регистрации/логина и публичных досок) добавьте:

3. **Authorization:** `Bearer <ВАШ_ТОКЕН>`

---

## 📚 REST API Документация

### 👤 Аутентификация

#### 1. Регистрация

* **URL:** `POST /api/auth/register`
* **Body:**
```json
{
  "email": "user@example.com",
  "name": "Alex",
  "password": "Password123!" 
}

```


*(Пароль: минимум 8 символов, цифры + спецсимволы)*

#### 2. Вход (Логин)

* **URL:** `POST /api/auth/login`
* **Body:**
```json
{ "email": "user@example.com", "password": "Password123!" }

```


* **Ответ:** Возвращает `token` и данные пользователя.

---

### 📋 Управление досками

#### 3. Получить список моих досок

* **URL:** `GET /api/boards`
* **Headers:** `Authorization: Bearer ...`
* **Описание:** Возвращает доски, созданные пользователем + доски, доступные ему.

#### 4. Создать доску

* **URL:** `POST /api/boards`
* **Headers:** `Authorization: Bearer ...`
* **Body:**
```json
{ "title": "My Project Board" }

```



#### 5. Получить данные доски (Приватная)

* **URL:** `GET /api/boards/:id`
* **Headers:** `Authorization: Bearer ...`
* **Ответ:** Возвращает объект доски и массив `elements` (содержимое холста).

#### 6. Получить публичную доску (Гостевой доступ)

* **URL:** `GET /board/:hash`
* **Headers:** `Authorization` **не требуется**.
* **Описание:** Доступ по уникальному хешу для публичных досок.

#### 7. Список всех публичных досок

* **URL:** `GET /api/boards/public`
* **Query Params:** `?sort=likes` (сортировка по популярности).

---

### ❤️ Социальные функции

#### 8. Предоставить доступ (Share)

* **URL:** `POST /api/boards/:id/share`
* **Headers:** `Authorization: Bearer ...`
* **Body:**
```json
{ "email": "friend@example.com" }

```



#### 9. Поставить лайк

* **URL:** `POST /api/boards/:id/like`
* **Headers:** `Authorization: Bearer ...`

---

## ⚡ WebSocket API (Socket.io)

**Endpoint:** `ws://localhost:3000`

### Подключение

При инициализации соединения передайте токен в объекте `auth`.

```javascript
const socket = io("http://localhost:3000", {
  auth: {
    token: "ВАШ_JWT_ТОКЕН" 
  }
});
// Для гостей токен не передается, сервер присвоит имя "Guest".

```

### Формат объекта "Element" (Пример)

```json
{
  "id": "uuid-v4",
  "type": "rect", 
  "x": 100,
  "y": 200,
  "width": 150,
  "height": 100,
  "content": "HexColor or Text",
  "rotation": 0
}

```

*Важно: Сервер проверяет, чтобы объект не выходил за границы 1600x900.*

### События от Клиента (Отправляем на сервер)

| Событие | Payload (Data) | Описание |
| --- | --- | --- |
| `JOIN_BOARD` | `{ "board_id": 1 }` | Вход в комнату доски. Обязательно первым действием. |
| `REQUEST_FOCUS` | `{ "board_id": 1, "element_id": "xyz" }` | Попытка захватить объект для редактирования. |
| `RELEASE_FOCUS` | `{ "board_id": 1, "element_id": "xyz", "element_data": {...} }` | Завершение редактирования. Сохраняет данные в БД. |
| `ADD_ELEMENT` | `{ "board_id": 1, "element": {...} }` | Создание нового объекта. |

### События от Сервера (Слушаем на клиенте)

| Событие | Payload (Data) | Описание |
| --- | --- | --- |
| `CURRENT_FOCUSES` | `{ "el_id": { "userName": "Ivan" } }` | Приходит при входе. Список занятых сейчас объектов. |
| `FOCUS_TAKEN` | `{ "element_id": "xyz", "user_name": "Alex" }` | Кто-то другой начал редактировать объект. Заблокируйте его у себя. |
| `FOCUS_RELEASED` | `{ "element_id": "xyz" }` | Объект освободился. Снимите блокировку. |
| `ELEMENT_UPDATED` | `{ "element_id": "xyz", "element_data": {...} }` | Объект изменился. Обновите его на канвасе. |
| `ELEMENT_CREATED` | `{ "element": {...} }` | Кто-то создал новый объект. Добавьте его. |
| `ERROR` | `{ "message": "..." }` | Ошибка (например, выход за границы холста). |

---

## 🛠 Структура БД (SQLite)

Файл базы данных: `database.sqlite` (создается в корне).

**Таблицы:**

1. `users` (id, email, name, password_hash)
2. `boards` (id, title, owner_id, hash, is_public, content JSON)
3. `board_access` (связь board_id <-> user_email)
4. `likes` (связь user_id <-> board_id)