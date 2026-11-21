# EAM-WIFI MikroTik RouterOS 7 connector
# Router-initiated HTTPS only. Do not expose RouterOS API/Winbox to the public internet.
# Set :global EAM_WIFI_TOKEN "<one-time-token-from-the-owner-dashboard>" before importing.
# Designed for RouterOS 7.13+; test on a spare router before production.

:global EAM_WIFI_TOKEN
:global EAM_WIFI_BASE "https://wifi.eckson.workers.dev"

:if ([:len $EAM_WIFI_TOKEN] < 32) do={ :error "Set the one-time EAM_WIFI_TOKEN first." }

/system script remove [find where name="eam-wifi-agent"]
/system scheduler remove [find where name="eam-wifi-agent"]

/system script add name="eam-wifi-agent" policy=read,write,test,ftp,policy,password,sensitive source={
  :local EAM_WIFI_TOKEN "__EAM_WIFI_TOKEN__"
  :local EAM_WIFI_BASE "https://wifi.eckson.workers.dev"
  :local jsonHeaders ("Authorization: Bearer " . $EAM_WIFI_TOKEN . ",Content-Type: application/json")
  :local heartbeat
  :local hbData
  :onerror hbErr in={
    :set heartbeat [/tool fetch url=($EAM_WIFI_BASE . "/api/router/heartbeat") http-method=post http-data="{}" http-header-field=$jsonHeaders output=user as-value check-certificate=yes]
    :set hbData [:deserialize from=json value=($heartbeat->"data")]
    :if (($hbData->"ok") != true) do={ :error "Heartbeat rejected" }
  } do={
    :log warning ("EAM-WIFI heartbeat failed: " . $hbErr)
    :return
  }

  :local response
  :local events
  :onerror pollErr in={
    :set response [/tool fetch url=($EAM_WIFI_BASE . "/api/router/events") http-method=post http-data="{}" http-header-field=$jsonHeaders output=user as-value check-certificate=yes]
    :set events [:deserialize from=json value=($response->"data")]
  } do={
    :log warning ("EAM-WIFI event poll failed: " . $pollErr)
    :return
  }

  :foreach event in=$events do={
    :local eventId ($event->"id")
    :local sessionId ($event->"session_id")
    :local eventType ($event->"event_type")
    :local payload ($event->"event_payload")
    :local success false
    :local errText ""
    :local resultPayload {}
    :onerror applyErr in={
      :if ($eventType = "voucher_redemption_requested") do={
        :local username ($payload->"username")
        :local password ($payload->"password")
        :local duration [:tonum ($payload->"duration_seconds")]
        :local mode ($payload->"session_mode")
        :local dataLimit [:tonum ($payload->"data_limit_bytes")]
        :local maxDevices [:tonum ($payload->"max_devices")]
        :local down [:tonum ($payload->"speed_down_kbps")]
        :local up [:tonum ($payload->"speed_up_kbps")]
        :local profileName ("EAMWIFI-" . [:pick $sessionId 0 8])
        :if ([:len $username] < 8 || [:len $password] < 8) do={ :error "Invalid voucher session credentials" }
        :if ([:len [/ip hotspot user find where name=$username]] > 0) do={ :error "Voucher user already exists; refusing duplicate activation" }
        :local profileArgs ("name=" . $profileName . " shared-users=" . $maxDevices)
        :if ($down > 0 && $up > 0) do={
          :set profileArgs ($profileArgs . " rate-limit=" . $up . "k/" . $down . "k")
        }
        /ip hotspot user profile add name=$profileName shared-users=$maxDevices
        :if ($down > 0 && $up > 0) do={
          /ip hotspot user profile set [find where name=$profileName] rate-limit=($up . "k/" . $down . "k")
        }
        :if ($mode = "connected_time") do={
          :if ($duration < 1) do={ :error "Invalid connected-time duration" }
          :if ($dataLimit > 0) do={
            /ip hotspot user add name=$username password=$password profile=$profileName limit-uptime=($duration . "s") limit-bytes-total=$dataLimit comment=("EAM-WIFI:" . $sessionId)
          } else={
            /ip hotspot user add name=$username password=$password profile=$profileName limit-uptime=($duration . "s") comment=("EAM-WIFI:" . $sessionId)
          }
        } else={
          :if ($dataLimit > 0) do={
            /ip hotspot user add name=$username password=$password profile=$profileName limit-bytes-total=$dataLimit comment=("EAM-WIFI:" . $sessionId)
          } else={
            /ip hotspot user add name=$username password=$password profile=$profileName comment=("EAM-WIFI:" . $sessionId)
          }
        }
        :set resultPayload {"username"=$username;"profile"=$profileName;"applied"=true}
      } else={
        :if ($eventType = "session_expiry_requested") do={
          :local username ($payload->"username")
          :local profileName ("EAMWIFI-" . [:pick $sessionId 0 8])
          /ip hotspot active remove [find where user=$username]
          /ip hotspot user remove [find where name=$username]
          /ip hotspot user profile remove [find where name=$profileName]
          :set resultPayload {"username"=$username;"expired"=true}
        } else={
          :error ("Unsupported EAM-WIFI event: " . $eventType)
        }
      }
      :set success true
    } do={
      :set errText $applyErr
      :log error ("EAM-WIFI event " . $eventId . " failed: " . $applyErr)
    }

    :local ackObject {"event_id"=$eventId;"success"=$success;"result_payload"=$resultPayload;"error"=$errText}
    :local ackBody [:serialize to=json value=$ackObject]
    :onerror ackErr in={
      /tool fetch url=($EAM_WIFI_BASE . "/api/router/events/complete") http-method=post http-data=$ackBody http-header-field=$jsonHeaders output=user as-value check-certificate=yes
    } do={
      :log warning ("EAM-WIFI acknowledgement failed: " . $ackErr)
    }
  }
  :log info ("EAM-WIFI connector checked " . [:len $events] . " router event(s)")
}

/system scheduler add name="eam-wifi-agent" interval=15s start-time=startup on-event="/system script run eam-wifi-agent" policy=read,write,test,ftp,policy,password,sensitive
/system script run eam-wifi-agent
:log info "EAM-WIFI connector installed. Check Log for heartbeat and event status."
