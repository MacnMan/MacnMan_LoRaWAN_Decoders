function decodeUplink(input) {
    var bytes = input.bytes;
    var data = {};
    var warnings = [];
    var errors = [];

    if (bytes.length < 2) {
        return {
            data: {},
            errors: ["Payload too short (< 2 bytes)"]
        };
    }

    var frameType = bytes[0];
    var frameSubType = bytes[1];

    // ─── Frame 0x01, 0x01 — Gas sensor reading (Analog_sensors) ───
    if (frameType === 0x01 && frameSubType === 0x01) {
        if (bytes.length < 9) {
            return {
                data: {},
                errors: ["Gas reading payload too short, expected 9 bytes, got " + bytes.length]
            };
        }

        data.frame_type = "gas_reading";

        // Gas percentages (no markers in new format)
        data.nh3_percent = bytes[2];
        data.h2s_percent = bytes[3];
        data.battery_percent = bytes[4];

        // Unix timestamp (4 bytes, big-endian)
        var ts = ((bytes[5] << 24) | (bytes[6] << 16) | (bytes[7] << 8) | bytes[8]) >>> 0;
        data.unix_timestamp = ts;
        data.device_time = new Date(ts * 1000).toISOString();

        // Optional alert flags
        data.h2s_alert = data.h2s_percent >= 50 ? "HIGH" :
                        data.h2s_percent >= 20 ? "WARNING" : "OK";
        data.nh3_alert = data.nh3_percent >= 50 ? "HIGH" :
                        data.nh3_percent >= 20 ? "WARNING" : "OK";
        if (data.battery_percent < 20) {
            warnings.push("Low battery: " + data.battery_percent + "%");
        }
    }

    // ─── Frame 0x00, 0x00 — Device info / boot packet (sendTamperData) ───
    else if (frameType === 0x00 && frameSubType === 0x00) {
        if (bytes.length < 17) {
            return {
                data: {},
                errors: ["Boot payload too short, expected 17 bytes, got " + bytes.length]
            };
        }

        data.frame_type = "device_info";

        // OEM ID (3 bytes ST Company ID)
        data.oem_id = ((bytes[2] << 16) | (bytes[3] << 8) | bytes[4])
                        .toString(16).toUpperCase();
        data.device_id_byte = bytes[5];

        // Hardware version (3 bytes)
        data.hardware_version = "V" + bytes[6] + "." + bytes[7] + "." + bytes[8];

        // Software version (3 bytes)
        data.software_version = "V" + bytes[9] + "." + bytes[10] + "." + bytes[11];

        // Tx duty cycle (2 bytes, big-endian)
        data.tx_dutycycle_seconds = (bytes[12] << 8) | bytes[13];

        // Unix timestamp (4 bytes, big-endian) — bytes 13–16
        var tsBoot = ((bytes[13] << 24) | (bytes[14] << 16) |
                      (bytes[15] << 8) | bytes[16]) >>> 0;
        data.unix_timestamp = tsBoot;
        data.device_time = new Date(tsBoot * 1000).toISOString();
    }

    // ─── Frame 0x02, 0x02 — Configuration response (SendBaud_Tx_responce) ───
    else if (frameType === 0x02 && frameSubType === 0x02) {
        if (bytes.length < 10) {
            return {
                data: {},
                errors: ["Config response payload too short"]
            };
        }

        data.frame_type = "config_response";
        data.port = bytes[2];
        data.status = bytes[3] === 0 ? "OK" : "ERROR";
        data.value = (bytes[4] << 8) | bytes[5];

        // Timestamp position depends on whether parity byte exists
        var tsOffset = bytes.length === 11 ? 7 : 6;
        if (bytes.length === 11) {
            data.parity = bytes[6];
        }
        var tsCfg = ((bytes[tsOffset] << 24) | (bytes[tsOffset + 1] << 16) |
                     (bytes[tsOffset + 2] << 8) | bytes[tsOffset + 3]) >>> 0;
        data.unix_timestamp = tsCfg;
        data.device_time = new Date(tsCfg * 1000).toISOString();
    }

    // ─── Frame 0x03, 0x01 — Trigger payload (AngTrigger_Up) ───
    else if (frameType === 0x03 && frameSubType === 0x01) {
        data.frame_type = "trigger_event";

        // Trigger payload is variable-length depending on enabled channels.
        // Last 5 bytes = battery (1) + timestamp (4)
        if (bytes.length >= 7) {
            data.battery_percent = bytes[bytes.length - 5];
            var tsTrig = ((bytes[bytes.length - 4] << 24) |
                          (bytes[bytes.length - 3] << 16) |
                          (bytes[bytes.length - 2] << 8) |
                           bytes[bytes.length - 1]) >>> 0;
            data.unix_timestamp = tsTrig;
            data.device_time = new Date(tsTrig * 1000).toISOString();
        }
    }

    // ─── Unknown frame ───
    else {
        data.frame_type = "unknown";
        data.frame_header = "0x" + ("0" + frameType.toString(16)).slice(-2) +
                          " 0x" + ("0" + frameSubType.toString(16)).slice(-2);
        warnings.push("Unrecognized frame type");
    }

    var result = { data: data };
    if (warnings.length > 0) result.warnings = warnings;
    if (errors.length > 0) result.errors = errors;
    return result;
}