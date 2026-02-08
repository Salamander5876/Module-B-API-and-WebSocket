require('dotenv').config(); // Загрузка переменных окружения
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Настройка CORS для Socket.IO и Express
const io = new Server(server, {
    cors: {
        origin: "*", // В продакшене лучше указать конкретный домен
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 4000;
const SECRET_KEY = process.env.SECRET_KEY || "dev_secret_key_CHANGE_ME";

// Middleware
app.use(cors());
app.use(express.json());

// --- DATABASE SETUP (Async Wrappers) ---
const db = new sqlite3.Database('./database.sqlite');

// Обертки для использования async/await с sqlite3
const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Инициализация таблиц
(async () => {
    try {
        await dbRun(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            name TEXT,
            password TEXT
        )`);
        await dbRun(`CREATE TABLE IF NOT EXISTS boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            owner_id INTEGER,
            hash TEXT UNIQUE,
            is_public INTEGER DEFAULT 0,
            content TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await dbRun(`CREATE TABLE IF NOT EXISTS board_access (
            board_id INTEGER,
            user_email TEXT
        )`);
        await dbRun(`CREATE TABLE IF NOT EXISTS likes (
            user_id INTEGER,
            board_id INTEGER,
            PRIMARY KEY (user_id, board_id)
        )`);
        console.log("Database initialized");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
})();

// --- HELPER FUNCTIONS ---
function validateElement(el) {
    if (!el) return false;
    // Проверка типов
    if (typeof el.x !== 'number' || typeof el.y !== 'number') return false;
    
    // Границы (1600x900)
    if (el.x < 0 || el.y < 0) return false;
    if (el.x > 1600 || el.y > 900) return false;
    
    // Проверка размеров (защита от отрицательных размеров)
    if (el.width && el.width < 0) return false;
    if (el.height && el.height < 0) return false;

    if (el.width && (el.x + el.width > 1600)) return false;
    if (el.height && (el.y + el.height > 900)) return false;

    return true;
}

// --- MIDDLEWARES ---

const checkClientId = (req, res, next) => {
    const clientId = req.headers['clientid'];
    if (!clientId) {
        return res.status(400).json({ error: "Missing ClientId header" });
    }
    next();
};

const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid token" });
        req.user = user;
        next();
    });
};

app.use(checkClientId);

// --- REST API (Refactored to Async/Await) ---

// 1. Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        // Простая валидация
        if (!email || !name || !password) return res.status(422).json({ error: "Missing fields" });
        if (password.length < 8) return res.status(422).json({ error: "Password too short" });

        const hash = bcrypt.hashSync(password, 10);
        await dbRun(`INSERT INTO users (email, name, password) VALUES (?, ?, ?)`, [email, name, hash]);
        res.status(201).json({ message: "Registered" });
    } catch (err) {
        res.status(422).json({ error: "Email already exists or error" });
    }
});

// 2. Авторизация
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await dbGet(`SELECT * FROM users WHERE email = ?`, [email]);
        
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// 3. Список досок
app.get('/api/boards', authenticate, async (req, res) => {
    try {
        const sql = `
            SELECT b.* FROM boards b
            LEFT JOIN board_access ba ON b.id = ba.board_id
            WHERE b.owner_id = ? OR ba.user_email = ?
        `;
        const rows = await dbAll(sql, [req.user.id, req.user.email]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Создание доски
app.post('/api/boards', authenticate, async (req, res) => {
    try {
        const { title } = req.body;
        const hash = uuidv4();
        const result = await dbRun(`INSERT INTO boards (title, owner_id, hash) VALUES (?, ?, ?)`, [title, req.user.id, hash]);
        res.status(201).json({ id: result.lastID, title, hash, is_public: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Публичные доски
app.get('/api/boards/public', async (req, res) => {
    try {
        const sort = req.query.sort;
        let sql = `
            SELECT b.id, b.title, b.owner_id, b.is_public, b.created_at, COUNT(l.user_id) as likes_count 
            FROM boards b 
            LEFT JOIN likes l ON b.id = l.board_id
            WHERE b.is_public = 1
            GROUP BY b.id
        `;
        if (sort === 'likes') sql += ` ORDER BY likes_count DESC`;
        
        const rows = await dbAll(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Получение одной доски
app.get('/api/boards/:id', authenticate, async (req, res) => {
    try {
        const board = await dbGet(`SELECT * FROM boards WHERE id = ?`, [req.params.id]);
        if (!board) return res.status(404).json({ error: "Not found" });

        // Проверка доступа (Owner или Access List) - упрощенно
        // В реальном проекте тут нужно проверить права доступа

        const likes = await dbGet(`SELECT COUNT(*) as cnt FROM likes WHERE board_id = ?`, [board.id]);
        board.likes_count = likes.cnt;
        board.elements = JSON.parse(board.content || '[]');
        res.json(board);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Доступ по Hash
app.get('/board/:hash', async (req, res) => {
    try {
        const board = await dbGet(`SELECT * FROM boards WHERE hash = ? AND is_public = 1`, [req.params.hash]);
        if (!board) return res.status(404).json({ error: "Not found or private" });
        
        board.elements = JSON.parse(board.content || '[]');
        res.json(board);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Расшарить
app.post('/api/boards/:id/share', authenticate, async (req, res) => {
    try {
        const { email } = req.body;
        await dbRun(`INSERT INTO board_access (board_id, user_email) VALUES (?, ?)`, [req.params.id, email]);
        res.json({ success: true });
    } catch (err) {
        // Игнорируем дубликаты
        res.json({ success: true });
    }
});

// 8. Лайк
app.post('/api/boards/:id/like', authenticate, async (req, res) => {
    try {
        await dbRun(`INSERT OR IGNORE INTO likes (user_id, board_id) VALUES (?, ?)`, [req.user.id, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- WEBSOCKET LOGIC (Optimized) ---

// Хранилище: { boardId: { elementId: { userId, userName } } }
const focusStore = {};
// Обратный индекс для быстрого отключения: { socketId: [ { boardId, elementId } ] }
const userLocks = {}; 

// Очередь записи для предотвращения Race Condition при записи JSON
// { boardId: Promise }
const boardWriteQueues = {};

// Функция для безопасного обновления JSON в БД (по очереди для каждой доски)
const safeUpdateBoardContent = (boardId, updateFunction) => {
    // Если очереди нет, создаем resolved promise
    if (!boardWriteQueues[boardId]) {
        boardWriteQueues[boardId] = Promise.resolve();
    }

    // Добавляем задачу в очередь
    boardWriteQueues[boardId] = boardWriteQueues[boardId].then(async () => {
        try {
            const row = await dbGet(`SELECT content FROM boards WHERE id = ?`, [boardId]);
            if (!row) return;

            let elements = JSON.parse(row.content || '[]');
            // Выполняем функцию модификации массива
            elements = updateFunction(elements);

            await dbRun(`UPDATE boards SET content = ? WHERE id = ?`, [JSON.stringify(elements), boardId]);
        } catch (err) {
            console.error(`Error saving board ${boardId}:`, err);
        }
    });

    return boardWriteQueues[boardId];
};


io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (!err) socket.user = decoded;
            // Если токен протух, можно пускать как гостя или выдавать ошибку.
            // Тут пускаем как гостя, если ошибка токена, или требуем строгий логин:
            else socket.user = { id: 'guest_' + socket.id.substr(0, 4), name: 'Guest' };
            next();
        });
    } else {
        socket.user = { id: 'guest_' + socket.id.substr(0, 4), name: 'Guest' };
        next();
    }
});

io.on('connection', (socket) => {
    // console.log(`WS Connected: ${socket.user.name} (${socket.id})`);

    socket.on('JOIN_BOARD', ({ board_id }) => {
        socket.join(board_id);
        if (focusStore[board_id]) {
            socket.emit('CURRENT_FOCUSES', focusStore[board_id]);
        }
    });

    socket.on('REQUEST_FOCUS', ({ board_id, element_id }) => {
        if (!focusStore[board_id]) focusStore[board_id] = {};
        
        const currentLock = focusStore[board_id][element_id];
        // Если занято другим
        if (currentLock && currentLock.userId !== socket.user.id) {
            socket.emit('ERROR', { message: "Object locked" });
            return;
        }

        // Занимаем
        focusStore[board_id][element_id] = { userId: socket.user.id, userName: socket.user.name };
        
        // Сохраняем в индекс для быстрого disconnect
        if (!userLocks[socket.id]) userLocks[socket.id] = [];
        userLocks[socket.id].push({ board_id, element_id });

        io.to(board_id).emit('FOCUS_TAKEN', { element_id, user_name: socket.user.name });
    });

    socket.on('RELEASE_FOCUS', async ({ board_id, element_id, element_data }) => {
        if (!validateElement(element_data)) {
            return;
        }

        // Используем очередь обновлений
        await safeUpdateBoardContent(board_id, (elements) => {
            const idx = elements.findIndex(el => el.id === element_id);
            if (idx !== -1) {
                elements[idx] = element_data;
            } else {
                elements.push(element_data);
            }
            return elements;
        });

        // Снимаем блокировку
        if (focusStore[board_id]) delete focusStore[board_id][element_id];
        
        // Чистим из userLocks
        if (userLocks[socket.id]) {
            userLocks[socket.id] = userLocks[socket.id].filter(l => l.element_id !== element_id);
        }

        io.to(board_id).emit('ELEMENT_UPDATED', { element_id, element_data });
        io.to(board_id).emit('FOCUS_RELEASED', { element_id });
    });

    socket.on('ADD_ELEMENT', async ({ board_id, element }) => {
        element.id = element.id || uuidv4();
        if (!validateElement(element)) return;

        // Используем очередь обновлений
        await safeUpdateBoardContent(board_id, (elements) => {
            elements.push(element);
            return elements;
        });

        io.to(board_id).emit('ELEMENT_CREATED', { element });
    });

    socket.on('disconnect', () => {
        // Быстрая очистка блокировок через userLocks
        if (userLocks[socket.id]) {
            userLocks[socket.id].forEach(({ board_id, element_id }) => {
                if (focusStore[board_id] && focusStore[board_id][element_id]) {
                    // Проверяем, что это действительно блокировка этого сокета
                    if (focusStore[board_id][element_id].userId === socket.user.id) {
                        delete focusStore[board_id][element_id];
                        io.to(board_id).emit('FOCUS_RELEASED', { element_id });
                    }
                }
            });
            delete userLocks[socket.id];
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});