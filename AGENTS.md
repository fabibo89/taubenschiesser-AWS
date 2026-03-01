# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Taubenschiesser Cloud Platform is a full-stack IoT application for managing ESP32-based bird detection/deterrence devices. It has four main services:

| Service | Tech | Port | Required |
|---------|------|------|----------|
| MongoDB | Docker (mongo:7.0) | 27017 | Yes |
| Backend API | Node.js/Express | 5001 | Yes |
| React Frontend | CRA (react-scripts) | 3000 | Yes |
| CV Service | Python/FastAPI | 8000 | Yes |
| Hardware Monitor | Python | - | Optional (needs real MQTT broker + ESP32 hardware) |

### Starting services

1. **MongoDB**: `sudo docker start taubenschiesser-mongodb-dev` (or create via `sudo docker run -d --name taubenschiesser-mongodb-dev -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password123 -e MONGO_INITDB_DATABASE=taubenschiesser mongo:7.0`)
2. **Backend**: `cd server && npx nodemon index.js` (or from root: `npm run server:dev`)
3. **Frontend**: `cd client && npm start` (or from root: `npm run client:dev`)
4. **Both backend+frontend**: `npm run dev` (uses `concurrently`)
5. **CV Service**: `cd cv-service && python3 app.py` (starts on port 8000)

### Key gotchas

- The YOLO ONNX model file (`models/yolo26m.onnx`, `yolov8l.onnx`, or any variant) is **gitignored** and must be obtained separately. Use `ultralytics` to export: `cd models && python3 -c "from ultralytics import YOLO; YOLO('yolo26n.pt').export(format='onnx', opset=21)"`. Then set `MODEL_PATH` in `cv-service/.env` (e.g. `../models/yolo26m.onnx`). Use `CV_SERVICE=yolo` for local ONNX.
- `.env` files for `server/`, `client/`, and `cv-service/` must be created from their `.env.example` counterparts before running services.
- The server `.env` has `PORT=5001` for local dev. The client's `package.json` proxy points to `http://localhost:5001`.
- Docker is required even for local development because MongoDB runs in a container.
- The `~/.local/bin` directory must be on `PATH` for Python CLI tools (uvicorn, etc.) installed via `pip3 install --user`.

### Lint, test, build commands

See `README.md` for standard commands. Key ones:
- **Lint (client)**: `cd client && npx eslint src/`
- **Test (server)**: `cd server && npm test` (jest, currently no test files)
- **Test (client)**: `cd client && CI=true npm test -- --watchAll=false` (currently no test files)
- **Build (client)**: `cd client && npm run build`
