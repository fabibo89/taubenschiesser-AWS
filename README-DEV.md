# 🚀 Taubenschiesser Development Guide

## Quick Start

### Start Development Environment
```bash
./dev-start.sh
```

### Stop Development Environment
```bash
./dev-stop.sh
```

## What the Scripts Do

### `dev-start.sh`
- ✅ Checks if Docker is running
- ✅ Installs all dependencies automatically
- ✅ Starts MongoDB (Docker)
- ✅ Starts MQTT broker (Docker)
- ✅ Starts Computer Vision service (Python)
- ✅ Starts React frontend (localhost:3000)
- ✅ Starts Node.js backend (localhost:5000)
- ✅ Handles cleanup on exit (Ctrl+C)

### `dev-stop.sh`
- ✅ Stops all Node.js processes
- ✅ Stops React development server
- ✅ Stops CV service
- ✅ Removes Docker containers
- ✅ Cleans up ports

## Services & Ports

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:3000 | React development server |
| **Backend API** | http://localhost:5000 | Node.js API server |
| **CV Service** | http://localhost:8000 | Computer Vision service |
| **MongoDB** | localhost:27017 | Database |
| **MQTT** | localhost:1883 | Hardware communication |

## Development Workflow

1. **Start development:**
   ```bash
   ./dev-start.sh
   ```

2. **Make changes** - Hot reload is enabled for both frontend and backend

3. **Stop when done:**
   ```bash
   ./dev-stop.sh
   ```

## Manual Development (Alternative)

If you prefer manual control:

```bash
# Start only required services
docker run -d -p 27017:27017 mongo:7.0
docker run -d -p 1883:1883 eclipse-mosquitto:2.0

# Start application
npm run dev
```

## Troubleshooting

### Port Already in Use
The scripts automatically detect and handle port conflicts.

### Docker Not Running
Make sure Docker Desktop is running before starting development.

### Dependencies Issues
The scripts automatically install dependencies, but you can also run:
```bash
npm install
cd server && npm install
cd ../client && npm install
```

## Environment Variables

The development environment uses these default settings:
- MongoDB: `mongodb://admin:password123@localhost:27017/taubenschiesser`
- JWT Secret: `dev-secret-key`
- API URL: `http://localhost:5000`
- CV Service: `http://localhost:8000`

## Production vs Development

- **Development**: Use `./dev-start.sh` (fast, hot-reload)
- **Production**: Use `docker-compose up` (full containerization)
