# EAM-WIFI MikroTik RouterOS 7 connector TEMPLATE (not executable until personalized by the owner dashboard)
# Router-initiated HTTPS only. Do not expose RouterOS API/Winbox to the public internet.
# The authenticated owner dashboard inserts a one-time credential in the saved script.
# The credential is stored in RouterOS script source and survives router reboot.
# Designed for RouterOS 7.13+; test on a spare router before production.

/system script remove [find where name="eam-wifi-agent"]
/system scheduler remove [find where name="eam-wifi-agent"]

/system script add name="eam-wifi-agent" policy=read,write,test,ftp,policy,password,sensitive source={
  :local EAM_WIFI_TOKEN "__EAM_WIFI_TOKEN__"
  :local EAM_WIFI_BASE "https://wifi.eckson.workers.dev"
  :local jsonHeaders ("Authorization: Bearer " . $EAM_WIFI_TOKEN, "Content-Type: application/json")
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
        :local macAddress ($payload->"mac_address")
        :local duration [:tonum ($payload->"duration_seconds")]
        :local mode ($payload->"session_mode")
        :local dataLimit 0
        :local dataValue ($payload->"data_limit_bytes")
        :if ([:typeof $dataValue] != "nil") do={ :set dataLimit [:tonum $dataValue] }
        :local maxDevices [:tonum ($payload->"max_devices")]
        :local down 0
        :local downValue ($payload->"speed_down_kbps")
        :if ([:typeof $downValue] != "nil") do={ :set down [:tonum $downValue] }
        :local up 0
        :local upValue ($payload->"speed_up_kbps")
        :if ([:typeof $upValue] != "nil") do={ :set up [:tonum $upValue] }
        :local profileName ("EAMWIFI-" . [:pick $sessionId 0 8])
        :if ([:len $username] < 8 || [:len $password] < 8) do={ :error "Invalid voucher session credentials" }
        :if ($mode = "connected_time" && $duration < 1) do={ :error "Invalid connected-time duration" }
        :local profileId [/ip hotspot user profile find where name=$profileName]
        :if ([:len $profileId] = 0) do={
          /ip hotspot user profile add name=$profileName shared-users=$maxDevices
          :set profileId [/ip hotspot user profile find where name=$profileName]
        } else={
          /ip hotspot user profile set $profileId shared-users=$maxDevices
        }
        :if ($down > 0 && $up > 0) do={
          /ip hotspot user profile set $profileId rate-limit=($up . "k/" . $down . "k")
        }
        :local userId [/ip hotspot user find where name=$username]
        :if ([:len $userId] > 0) do={
          :if ([/ip hotspot user get $userId comment] != ("EAM-WIFI:" . $sessionId)) do={ :error "Voucher username collision; refusing to overwrite another session" }
        }
        :if ($mode = "connected_time") do={
          :if ($dataLimit > 0) do={
            :if ([:len $userId] = 0) do={
              /ip hotspot user add name=$username password=$password profile=$profileName limit-uptime=($duration . "s") limit-bytes-total=$dataLimit comment=("EAM-WIFI:" . $sessionId)
            } else={
              /ip hotspot user set $userId password=$password profile=$profileName limit-uptime=($duration . "s") limit-bytes-total=$dataLimit
            }
          } else={
            :if ([:len $userId] = 0) do={
              /ip hotspot user add name=$username password=$password profile=$profileName limit-uptime=($duration . "s") comment=("EAM-WIFI:" . $sessionId)
            } else={
              /ip hotspot user set $userId password=$password profile=$profileName limit-uptime=($duration . "s")
            }
          }
        } else={
          :if ($dataLimit > 0) do={
            :if ([:len $userId] = 0) do={
              /ip hotspot user add name=$username password=$password profile=$profileName limit-bytes-total=$dataLimit comment=("EAM-WIFI:" . $sessionId)
            } else={
              /ip hotspot user set $userId password=$password profile=$profileName limit-bytes-total=$dataLimit
            }
          } else={
            :if ([:len $userId] = 0) do={
              /ip hotspot user add name=$username password=$password profile=$profileName comment=("EAM-WIFI:" . $sessionId)
            } else={
              /ip hotspot user set $userId password=$password profile=$profileName
            }
          }
        }
        :if ($maxDevices = 1) do={
          /ip hotspot user set [find where name=$username] mac-address=$macAddress
        } else={
          /ip hotspot user set [find where name=$username] !mac-address
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
