#!/bin/bash

# Taubenschiesser Development Environment Stopper
# This script stops all development services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to stop CV service
stop_cv_service() {
    # Find ALL Python app.py processes (simpler approach)
    CV_PIDS=$(ps aux | grep "[P]ython.*app.py" | awk '{print $2}')
    
    if [ ! -z "$CV_PIDS" ]; then
        for pid in $CV_PIDS; do
            print_status "Stopping CV service (PID: $pid)..."
            kill $pid 2>/dev/null || true
        done
        print_success "CV service stopped"
    else
        print_warning "CV service was not running"
    fi
    
    # Clean up PID file
    rm -f cv-service.pid
}

# Function to stop Hardware Monitor
stop_hardware_monitor() {
    # Find ALL Python main.py processes (simpler approach)
    HW_PIDS=$(ps aux | grep "[P]ython.*main.py" | awk '{print $2}')
    
    if [ ! -z "$HW_PIDS" ]; then
        for pid in $HW_PIDS; do
            print_status "Stopping Hardware Monitor (PID: $pid)..."
            kill $pid 2>/dev/null || true
        done
        print_success "Hardware Monitor stopped"
    else
        print_warning "Hardware Monitor was not running"
    fi
    
    # Clean up PID file
    rm -f hardware-monitor.pid
}

# Function to stop Docker containers
stop_docker_containers() {
    print_status "Stopping Docker containers..."
    
    # Stop MongoDB container (but keep it for data persistence)
    if docker ps -q -f name=taubenschiesser-mongodb-dev | grep -q .; then
        print_status "Stopping MongoDB container..."
        docker stop taubenschiesser-mongodb-dev
        print_success "MongoDB container stopped (data preserved)"
    else
        print_warning "MongoDB container was not running"
    fi
    
    # MQTT container nicht mehr verwendet - nutze deinen eigenen Mosquitto-Server
    # if docker ps -q -f name=taubenschiesser-mqtt-dev | grep -q .; then
    #     print_status "Stopping MQTT container..."
    #     docker stop taubenschiesser-mqtt-dev
    #     docker rm taubenschiesser-mqtt-dev
    #     print_success "MQTT container stopped and removed"
    # else
    #     print_warning "MQTT container was not running"
    # fi
}

# Function to kill any remaining Node.js processes
stop_node_processes() {
    print_status "Checking for running Node.js processes..."
    
    # Find and kill Node.js processes related to our project
    NODE_PIDS=$(pgrep -f "node.*server" || true)
    if [ ! -z "$NODE_PIDS" ]; then
        print_status "Stopping Node.js server processes..."
        echo $NODE_PIDS | xargs kill 2>/dev/null || true
        print_success "Node.js processes stopped"
    else
        print_warning "No Node.js server processes found"
    fi
    
    # Find and kill React development server
    REACT_PIDS=$(pgrep -f "react-scripts start" || true)
    if [ ! -z "$REACT_PIDS" ]; then
        print_status "Stopping React development server..."
        echo $REACT_PIDS | xargs kill 2>/dev/null || true
        print_success "React development server stopped"
    else
        print_warning "No React development server found"
    fi
}

# Function to clean up any remaining processes on specific ports
cleanup_ports() {
    print_status "Cleaning up processes on development ports..."
    
    # Kill processes on port 3000 (React)
    if lsof -ti:3000 > /dev/null 2>&1; then
        print_status "Killing process on port 3000..."
        lsof -ti:3000 | xargs kill 2>/dev/null || true
    fi
    
    # Kill processes on port 5000 (API)
    if lsof -ti:5000 > /dev/null 2>&1; then
        print_status "Killing process on port 5000..."
        lsof -ti:5000 | xargs kill 2>/dev/null || true
    fi
    
    # Kill processes on port 8000 (CV service)
    if lsof -ti:8000 > /dev/null 2>&1; then
        print_status "Killing process on port 8000..."
        lsof -ti:8000 | xargs kill 2>/dev/null || true
    fi
}

# Main execution
main() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Stopping Taubenschiesser Development           ║"
    echo "║                      Environment                            ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Stop all services
    stop_cv_service
    stop_hardware_monitor
    stop_docker_containers
    stop_node_processes
    cleanup_ports
    
    print_success "All development services have been stopped!"
    print_status "You can now run './dev-start.sh' to start development again"
}

# Run main function
main "$@"
