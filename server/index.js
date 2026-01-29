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
const io = new Server(server, {
    cors: { origin: "*" } // Разрешаем доступ с любого фронтенда
});

const PORT = 3000;
const SECRET_KEY = "comp_secret_key"; // В реальном проекте - в .env

// Middleware
app.use(cors());
app.use(express.json());

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    // Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        name TEXT,
        password TEXT
    )`);
    // Доски
    db.run(`CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        owner_id INTEGER,
        hash TEXT UNIQUE, -- для публичных ссылок
        is_public INTEGER DEFAULT 0,
        content TEXT DEFAULT '[]', -- JSON массив объектов
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Доступы
    db.run(`CREATE TABLE IF NOT EXISTS board_access (
        board_id INTEGER,
        user_email TEXT
    )`);
    // Лайки
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        user_id INTEGER,
        board_id INTEGER,
        PRIMARY KEY (user_id, board_id)
    )`);
});

// --- HELPER FUNCTIONS ---
function validateElement(el) {
    // Валидация границ холста 1600x900
    if (el.x < 0 || el.y < 0) return false;
    // Простая проверка (для вращения логика сложнее, но для базы достаточно проверить origin)
    // ТЗ требует запретить перемещение ЗА пределы.
    if (el.x > 1600 || el.y > 900) return false;
    if (el.x + el.width > 1600 || el.y + el.height > 900) return false;
    return true;
}

// --- MIDDLEWARES ---

// Проверка ClientId (по ТЗ)
const checkClientId = (req, res, next) => {
    const clientId = req.headers['clientid'];
    if (!clientId) {
        return res.status(400).json({ error: "Missing ClientId header" });
    }
    next();
};

// Проверка Токена
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

// --- REST API ---

// 1. Регистрация
app.post('/api/auth/register', (req, res) => {
    const { email, name, password } = req.body;
    // Валидация (упрощенная)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const nameRegex = /^[a-zA-Z]+$/;
    // Пароль: 8+, цифры, спецсимволы
    const passRegex = /^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{8,}$/;

    if (!emailRegex.test(email) || !nameRegex.test(name) || !passRegex.test(password)) {
        return res.status(422).json({ error: "Validation failed" });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (email, name, password) VALUES (?, ?, ?)`, 
        [email, name, hash], 
        function(err) {
            if (err) return res.status(422).json({ error: "Email already exists" });
            res.status(201).json({ message: "Registered" });
        }
    );
});

// 2. Авторизация
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET_KEY);
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
});

// 3. Список досок (Мои + Доступные)
app.get('/api/boards', authenticate, (req, res) => {
    const sql = `
        SELECT b.* FROM boards b
        LEFT JOIN board_access ba ON b.id = ba.board_id
        WHERE b.owner_id = ? OR ba.user_email = ?
    `;
    db.all(sql, [req.user.id, req.user.email], (err, rows) => {
        res.json(rows);
    });
});

// 4. Создание доски
app.post('/api/boards', authenticate, (req, res) => {
    const { title } = req.body;
    const hash = uuidv4();
    db.run(`INSERT INTO boards (title, owner_id, hash) VALUES (?, ?, ?)`, 
        [title, req.user.id, hash], 
        function(err) {
            if(err) return res.status(500).json({error: err.message});
            res.status(201).json({ id: this.lastID, title, hash, is_public: 0 });
        }
    );
});

// 5. Публичные доски
app.get('/api/boards/public', (req, res) => {
    const sort = req.query.sort; // ?sort=likes
    let sql = `
        SELECT b.*, COUNT(l.user_id) as likes_count 
        FROM boards b 
        LEFT JOIN likes l ON b.id = l.board_id
        WHERE b.is_public = 1
        GROUP BY b.id
    `;
    if (sort === 'likes') {
        sql += ` ORDER BY likes_count DESC`;
    }
    db.all(sql, [], (err, rows) => {
        res.json(rows);
    });
});

// 6. Получение одной доски (по ID или HASH)
// Middleware для проверки доступа к конкретной доске опустим для краткости, 
// но в реальном коде нужно проверять owner_id/access/public
app.get('/api/boards/:id', authenticate, (req, res) => {
    db.get(`SELECT * FROM boards WHERE id = ?`, [req.params.id], (err, board) => {
        if(!board) return res.status(404).json({error: "Not found"});
        // Подгружаем лайки
        db.get(`SELECT COUNT(*) as cnt FROM likes WHERE board_id = ?`, [board.id], (e, r) => {
            board.likes_count = r.cnt;
            board.elements = JSON.parse(board.content);
            res.json(board);
        });
    });
});

// Доступ по Hash (без авторизации)
app.get('/board/:hash', (req, res) => {
    db.get(`SELECT * FROM boards WHERE hash = ? AND is_public = 1`, [req.params.hash], (err, board) => {
        if(!board) return res.status(404).json({error: "Not found or private"});
        board.elements = JSON.parse(board.content);
        res.json(board);
    });
});

// 7. Расшарить доску
app.post('/api/boards/:id/share', authenticate, (req, res) => {
    const { email } = req.body;
    db.run(`INSERT INTO board_access (board_id, user_email) VALUES (?, ?)`, 
        [req.params.id, email], (err) => res.json({success: true}));
});

// 8. Лайк
app.post('/api/boards/:id/like', authenticate, (req, res) => {
    db.run(`INSERT OR IGNORE INTO likes (user_id, board_id) VALUES (?, ?)`, 
        [req.user.id, req.params.id], (err) => res.json({success: true}));
});


// --- WEBSOCKET LOGIC ---

// Хранилище фокусов в памяти: { boardId: { elementId: { userId, userName } } }
const focusStore = {}; 

io.use((socket, next) => {
    // Аутентификация сокета
    const token = socket.handshake.auth.token;
    if (token) {
        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (!err) socket.user = decoded;
            next();
        });
    } else {
        // Гостевой вход (для публичных досок)
        socket.user = { id: 'guest_' + socket.id, name: 'Guest' };
        next();
    }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.name}`);

    // Вход в комнату доски
    socket.on('JOIN_BOARD', ({ board_id }) => {
        socket.join(board_id);
        // Отправить текущие фокусы новому юзеру
        if (focusStore[board_id]) {
            socket.emit('CURRENT_FOCUSES', focusStore[board_id]);
        }
    });

    // Попытка взять фокус
    socket.on('REQUEST_FOCUS', ({ board_id, element_id }) => {
        if (!focusStore[board_id]) focusStore[board_id] = {};
        
        const currentLock = focusStore[board_id][element_id];
        
        // Если объект уже занят кем-то другим
        if (currentLock && currentLock.userId !== socket.user.id) {
            socket.emit('ERROR', { message: "Object is locked by another user" });
            return;
        }

        // Занимаем объект
        focusStore[board_id][element_id] = { 
            userId: socket.user.id, 
            userName: socket.user.name 
        };

        // Сообщаем всем в комнате
        io.to(board_id).emit('FOCUS_TAKEN', { 
            element_id, 
            user_name: socket.user.name 
        });
    });

    // Обновление/снятие фокуса (сохранение)
    socket.on('RELEASE_FOCUS', ({ board_id, element_id, element_data }) => {
        // Валидация на сервере
        if (!validateElement(element_data)) {
            socket.emit('ERROR', { message: "Invalid coordinates (Out of bounds)" });
            return; // Не сохраняем
        }

        // Обновляем БД (нужно считать текущий JSON, обновить нужный элемент и записать обратно)
        // Для упрощения примера - делаем это асинхронно, не блокируя сокет
        db.get(`SELECT content FROM boards WHERE id = ?`, [board_id], (err, row) => {
            if (row) {
                let elements = JSON.parse(row.content);
                const idx = elements.findIndex(el => el.id === element_id);
                if (idx !== -1) {
                    elements[idx] = element_data;
                } else {
                    elements.push(element_data); // Если новый
                }
                
                db.run(`UPDATE boards SET content = ? WHERE id = ?`, [JSON.stringify(elements), board_id]);
                
                // Снимаем блокировку
                if (focusStore[board_id]) delete focusStore[board_id][element_id];

                // Рассылаем обновление всем
                io.to(board_id).emit('ELEMENT_UPDATED', { element_id, element_data });
                io.to(board_id).emit('FOCUS_RELEASED', { element_id });
            }
        });
    });

    // Создание элемента
    socket.on('ADD_ELEMENT', ({ board_id, element }) => {
        element.id = uuidv4(); // Генерируем ID на сервере или берем с клиента
        if (!validateElement(element)) return;

        db.get(`SELECT content FROM boards WHERE id = ?`, [board_id], (err, row) => {
            if(row) {
                let elements = JSON.parse(row.content);
                elements.push(element);
                db.run(`UPDATE boards SET content = ? WHERE id = ?`, [JSON.stringify(elements), board_id]);
                io.to(board_id).emit('ELEMENT_CREATED', { element });
            }
        });
    });

    socket.on('disconnect', () => {
        // Очистка фокусов при отключении
        // Проходимся по всем доскам и удаляем локи этого юзера
        for (const boardId in focusStore) {
            for (const elId in focusStore[boardId]) {
                if (focusStore[boardId][elId].userId === socket.user.id) {
                    delete focusStore[boardId][elId];
                    io.to(boardId).emit('FOCUS_RELEASED', { element_id: elId });
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});