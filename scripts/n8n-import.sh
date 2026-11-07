#!/usr/bin/env sh
# Imports the exported workflows into the running n8n container, publishes
# them, and restarts n8n so the webhook and schedule go live.
set -eu
cd "$(dirname "$0")/.."
docker compose exec n8n n8n import:workflow --separate --input=/workflows
for id in lendloopErrorWf1 lendloopReqNotif lendloopOverdue1; do
  docker compose exec n8n n8n publish:workflow --id="$id"
done
docker compose restart n8n
echo "Workflows imported and published. Editor: http://localhost:5678"
