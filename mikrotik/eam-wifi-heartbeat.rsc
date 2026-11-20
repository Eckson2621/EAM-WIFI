# EAM-WIFI MikroTik RouterOS v7 heartbeat starter
# Replace the two values below with the Worker URL and one-time device token.
# Keep this script private: the token grants this router identity access.
# This starter ONLY sends authenticated heartbeats. It does NOT yet create hotspot users.

:global eamWifiWorker "https://YOUR-WORKER-DOMAIN"
:global eamWifiDeviceToken "PASTE_ONE_TIME_DEVICE_TOKEN_HERE"

:do {
  /tool fetch url=($eamWifiWorker . "/api/router/heartbeat") \
    http-method=post \
    http-header-field=("Authorization: Bearer " . $eamWifiDeviceToken) \
    keep-result=no
  :log info "EAM-WIFI router heartbeat sent"
} on-error={
  :log warning "EAM-WIFI heartbeat failed; check internet and device token"
}
