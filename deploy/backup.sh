#!/bin/sh
# Nightly pg_dump at 02:00 UTC into /backups, keeping $KEEP_DAYS days. Copy ./backups off the VM (rclone/OCI Object Storage).
set -eu
while true; do
  now=$(date -u +%H%M)
  if [ "$now" = "0200" ] || [ ! -f /backups/.initialized ]; then
    file="/backups/pingx-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    pg_dump --no-owner | gzip > "$file.tmp" && mv "$file.tmp" "$file"
    touch /backups/.initialized
    find /backups -name 'pingx-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
    echo "backup written: $file"
    sleep 60
  fi
  sleep 30
done
