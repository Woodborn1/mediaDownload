# 🎬 VideoLoad

Завантажувач відео з YouTube, Instagram, TikTok та Twitch.  
Підтримує вибір якості та таймкоди (завантаження фрагментів).

---

## 🚀 Деплой на Render

### 1. Підготовка репозиторію

```bash
git init
git add .
git commit -m "initial commit"
# Запуш на GitHub/GitLab
git remote add origin https://github.com/YOUR_USER/videoload.git
git push -u origin main
```

### 2. Створення сервісу на Render

1. Зайди на [render.com](https://render.com) → **New → Web Service**
2. Підключи свій GitHub репозиторій
3. Render автоматично визначить `Dockerfile`
4. Натисни **Deploy**

> ⚠️ На **Free** плані Render диск не зберігається між рестартами.  
> Для збереження файлів — використовуй **Starter** план або підключи MongoDB (дивись нижче).

---

## 💻 Локальний запуск

### Вимоги
- Node.js 18+
- Python 3 (для yt-dlp)
- ffmpeg

### Встановлення

```bash
# yt-dlp (macOS/Linux)
pip3 install yt-dlp
# або
brew install yt-dlp

# ffmpeg (macOS)
brew install ffmpeg
# ffmpeg (Ubuntu)
apt-get install ffmpeg

# Залежності Node
npm install

# Запуск
npm start
# або для розробки:
npm run dev
```

Відкрий http://localhost:3000

---

## 🗄️ Підключення MongoDB (опціонально)

Якщо хочеш зберігати історію завдань і не втрачати посилання між перезапусками:

### 1. Додай залежність

```bash
npm install mongoose
```

### 2. Додай .env

```
MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/videoload
```

### 3. Заміни `jobs` Map на модель Mongoose

Приклад схеми (додати у `server.js`):

```js
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

const JobSchema = new mongoose.Schema({
  id: String,
  status: String,      // 'downloading' | 'done' | 'error'
  progress: Number,
  filename: String,
  error: String,
}, { timestamps: true });

const Job = mongoose.model('Job', JobSchema);
```

Потім замінити `jobs.set(...)` → `await Job.create(...)` і `jobs.get(...)` → `await Job.findOne({ id })`.

---

## 📁 Структура проєкту

```
videoload/
├── server.js          # Express сервер + API
├── public/
│   └── index.html     # Frontend (один файл)
├── downloads/         # Тимчасові відео (авто-очистка)
├── Dockerfile         # Для Render
├── render.yaml        # Конфіг Render
└── package.json
```

---

## 🔌 API

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/api/info?url=...` | Інфо про відео + доступні формати |
| POST | `/api/download` | Запустити завантаження, повертає `jobId` |
| GET | `/api/status/:jobId` | Статус і прогрес завдання |
| GET | `/api/file/:jobId` | Скачати готовий файл |

### POST `/api/download` body
```json
{
  "url": "https://youtube.com/watch?v=...",
  "format_id": "bestvideo+bestaudio/best",
  "start_time": "00:08:00",   // опційно
  "end_time": "00:09:00"      // опційно
}
```
