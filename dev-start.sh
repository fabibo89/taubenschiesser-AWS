#!/bin/bash

# Taubenschiesser Development Environment Starter
# This script starts all necessary services for local development

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local host=$1
    local port=$2
    local service_name=$3
    local max_attempts=30
    local attempt=1

    print_status "Waiting for $service_name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if nc -z $host $port 2>/dev/null; then
            print_success "$service_name is ready!"
            return 0
        fi
        
        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done
    
    print_error "$service_name failed to start after $max_attempts seconds"
    return 1
}

# Function to start MongoDB if not running
start_mongodb() {
    if check_port 27017; then
        print_warning "MongoDB is already running on port 27017"
    else
        # Check if container exists but is stopped
        if docker ps -a --format "table {{.Names}}" | grep -q "taubenschiesser-mongodb-dev"; then
            print_status "Starting existing MongoDB container..."
            docker start taubenschiesser-mongodb-dev > /dev/null 2>&1
        else
            print_status "Creating new MongoDB container..."
            docker run -d \
                --name taubenschiesser-mongodb-dev \
                -p 27017:27017 \
                -e MONGO_INITDB_ROOT_USERNAME=admin \
                -e MONGO_INITDB_ROOT_PASSWORD=password123 \
                -e MONGO_INITDB_DATABASE=taubenschiesser \
                mongo:7.0 > /dev/null 2>&1
        fi
        
        wait_for_service localhost 27017 "MongoDB"
    fi
}

# Function to start MQTT broker if not running
# DEAKTIVIERT - Nutze deinen vorhandenen Mosquitto-Server in der Wohnung
# Konfiguriere die IP im Dashboard: Profil -> Einstellungen -> MQTT
# start_mqtt() {
#     if check_port 1883; then
#         print_warning "MQTT broker is already running on port 1883"
#     else
#         print_status "Starting MQTT broker..."
#         docker run -d \
#             --name taubenschiesser-mqtt-dev \
#             -p 1883:1883 \
#             -p 9001:9001 \
#             eclipse-mosquitto:2.0 > /dev/null 2>&1
#         
#         wait_for_service localhost 1883 "MQTT broker"
#     fi
# }

# Function to start CV service if not running
start_cv_service() {
    # Find ALL Python app.py processes (simpler approach)
    OLD_PIDS=$(ps aux | grep "[P]ython.*app.py" | awk '{print $2}')
    
    if [ ! -z "$OLD_PIDS" ]; then
        print_warning "Found existing CV service instance(s), stopping them..."
        for pid in $OLD_PIDS; do
            print_status "Stopping old instance (PID: $pid)"
            kill $pid 2>/dev/null || true
        done
        sleep 2
    fi
    
    # Clean up old PID file
    rm -f cv-service.pid
    
    print_status "Starting Computer Vision service..."
    cd cv-service
    if [ ! -f "app.py" ]; then
        print_error "CV service app.py not found"
        cd ..
        return 1
    fi
    
    # Clear old log file to start fresh
    > ../cv-service.log
    
    # Start CV service in background
    nohup python3 app.py > ../cv-service.log 2>&1 &
    CV_PID=$!
    echo $CV_PID > ../cv-service.pid
    cd ..
    
    print_success "CV service started (PID: $CV_PID)"
    print_status "Only one instance is running now"
}

# Function to start Hardware Monitor if not running
start_hardware_monitor() {
    # Find ALL Python main.py processes (simpler approach)
    OLD_PIDS=$(ps aux | grep "[P]ython.*main.py" | awk '{print $2}')
    
    if [ ! -z "$OLD_PIDS" ]; then
        print_warning "Found existing Hardware Monitor instance(s), stopping them..."
        for pid in $OLD_PIDS; do
            print_status "Stopping old instance (PID: $pid)"
            kill $pid 2>/dev/null || true
        done
        sleep 2
    fi
    
    # Clean up old PID file
    rm -f hardware-monitor.pid
    
    print_status "Starting Hardware Monitor service..."
    cd hardware-monitor
    if [ ! -f "main.py" ]; then
        print_error "Hardware Monitor main.py not found"
        cd ..
        return 1
    fi
    
    # Clear old log file to start fresh
    > ../hardware-monitor.log
    
    # Start Hardware Monitor in background
    nohup python3 main.py > ../hardware-monitor.log 2>&1 &
    HW_PID=$!
    echo $HW_PID > ../hardware-monitor.pid
    cd ..
    
    print_success "Hardware Monitor started (PID: $HW_PID)"
    print_status "Only one instance is running now"
}

# Function to install dependencies if needed
install_dependencies() {
    print_status "Checking dependencies..."
    
    # Check if node_modules exists in root
    if [ ! -d "node_modules" ]; then
        print_status "Installing root dependencies..."
        npm install
    fi
    
    # Check server dependencies
    if [ ! -d "server/node_modules" ]; then
        print_status "Installing server dependencies..."
        cd server && npm install && cd ..
    fi
    
    # Check client dependencies
    if [ ! -d "client/node_modules" ]; then
        print_status "Installing client dependencies..."
        cd client && npm install && cd ..
    fi
}

# Function to start the main application
start_application() {
    print_status "Starting Taubenschiesser application..."
    
    # Set environment variables for development
    export NODE_ENV=development
    export MONGODB_URI=mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin
    export JWT_SECRET=dev-secret-key
    export CLIENT_URL=http://localhost:3000
    export CV_SERVICE_URL=http://localhost:8000
    export API_URL=http://localhost:5001
    # MQTT_BROKER wird über Dashboard konfiguriert (Profil -> Einstellungen)
    # export MQTT_BROKER=mqtt://YOUR_MOSQUITTO_IP:1883
    
    # Start the application using the npm script
    print_success "Starting development servers..."
    print_status "Frontend will be available at: http://localhost:3000"
    print_status "Backend API will be available at: http://localhost:5001"
    print_status "CV Service will be available at: http://localhost:8000"
    print_status "Hardware Monitor is running (check logs: tail -f hardware-monitor.log)"
    print_status "MongoDB will be available at: localhost:27017"
    print_status "MQTT: Nutze deinen Mosquitto-Server (konfiguriere im Dashboard)"
    print_status ""
    print_status "Press Ctrl+C to stop all services"
    print_status ""
    
    # Start the main application
    print_status "Starting Node.js services..."
    npm run dev
}

# Function to cleanup on exit
cleanup() {
    print_status "Cleaning up..."
    
    # Kill CV service if it was started by this script
    if [ -f "cv-service.pid" ]; then
        CV_PID=$(cat cv-service.pid)
        if ps -p $CV_PID > /dev/null 2>&1; then
            kill $CV_PID
        fi
        rm -f cv-service.pid
    fi
    
    # Kill Hardware Monitor if it was started by this script
    if [ -f "hardware-monitor.pid" ]; then
        HW_PID=$(cat hardware-monitor.pid)
        if ps -p $HW_PID > /dev/null 2>&1; then
            kill $HW_PID
        fi
        rm -f hardware-monitor.pid
    fi
    
    # Stop Docker containers (but keep them for data persistence)
    docker stop taubenschiesser-mongodb-dev 2>/dev/null || true
    # Note: We don't remove containers to preserve data
    # MQTT container nicht mehr verwendet - nutze deinen eigenen Server
    
    print_success "Cleanup completed"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution
main() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                Taubenschiesser Development                  ║"
    echo "║                      Environment Starter                    ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Check if Docker is running
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ] || [ ! -d "server" ] || [ ! -d "client" ]; then
        print_error "Please run this script from the taubenschiesser-cursor directory"
        exit 1
    fi
    
    # Install dependencies
    install_dependencies
    
    # Start required services
    start_mongodb
    # start_mqtt  # Temporarily disabled
    start_cv_service
    start_hardware_monitor
    
    # Start the main application
    start_application
}

# Run main function
main "$@"
