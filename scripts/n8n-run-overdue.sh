#!/usr/bin/env sh
# Runs the overdue reminders workflow now instead of waiting for 09:00.
# A second task-broker port avoids clashing with the running instance.
set -eu
cd "$(dirname "$0")/.."
docker compose exec -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=lendloopOverdue1
