#!/bin/bash
# Backfill im Host-Netzwerk ausführen (localhost = Host mit MongoDB).
# Nutzen wenn der API-Container per host.docker.internal nicht an MongoDB kommt.
#
# Aufruf (auf dem Server, aus ~/docker/taubenschiesser-AWS):
#   ./run-backfill-host-network.sh
# Oder mit eigener URI:
#   MONGODB_URI='mongodb://user:pass@localhost:27017/taubenschiesser?authSource=admin' ./run-backfill-host-network.sh

set -e
IMAGE=$(docker inspect taubenschiesser-api-prod --format '{{.Config.Image}}' 2>/dev/null || true)
if [ -z "$IMAGE" ]; then
  echo "Container taubenschiesser-api-prod nicht gefunden. Bitte zuerst: docker compose -f docker-compose.prod.yml up -d"
  exit 1
fi
URI="${MONGODB_URI:-mongodb://fabian:rotwand89@localhost:27017/taubenschiesser?authSource=admin}"
echo "Starte Backfill (Host-Netzwerk, URI mit localhost)..."
docker run --rm --network host -e MONGODB_URI="$URI" --entrypoint node "$IMAGE" scripts/backfill_target_bird.js
