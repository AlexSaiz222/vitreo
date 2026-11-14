#!/bin/sh
# Builds the password file from environment variables on every start, so no
# secret (or hash) ever lives in the repository, then starts Mosquitto.
set -eu

auth_dir=/mosquitto/auth
mkdir -p "$auth_dir"
# A restarted container (Docker or the PC restarting) still has the previous
# files, and `mosquitto_passwd -c` refuses to overwrite them: start clean.
rm -f "$auth_dir/passwd" "$auth_dir/acl"

mosquitto_passwd -c -b "$auth_dir/passwd" device "$MQTT_DEVICE_PASSWORD"
mosquitto_passwd -b "$auth_dir/passwd" hub "$MQTT_HUB_PASSWORD"
mosquitto_passwd -b "$auth_dir/passwd" web "$MQTT_WEB_PASSWORD"
cp /vitreo/acl "$auth_dir/acl"

chown -R mosquitto:mosquitto "$auth_dir"
chmod 0700 "$auth_dir"
chmod 0600 "$auth_dir/passwd" "$auth_dir/acl"

exec /docker-entrypoint.sh mosquitto -c /vitreo/mosquitto.conf
