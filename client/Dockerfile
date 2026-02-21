# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Build arguments für React Environment-Variablen
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
# REACT_APP_* Variablen werden beim Build in den Code eingebaut
# NODE_OPTIONS: mehr Heap für Webpack-Build (verhindert Hänger bei "Creating an optimized production build")
# GENERATE_SOURCEMAP=false: reduziert Speicher und Buildzeit
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV GENERATE_SOURCEMAP=false
ENV CI=true
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built app
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
