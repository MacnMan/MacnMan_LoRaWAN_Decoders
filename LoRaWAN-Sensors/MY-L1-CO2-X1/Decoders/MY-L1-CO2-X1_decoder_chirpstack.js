// ===================================================================
// MY-L1-CO2-X1 — STCC4 CO2 + SHT4x Temperature & Humidity LoRaWAN node
// ChirpStack v4 uplink decoder (decodeUplink)
// Decoder only: this file has no downlink encoder, so a downlink queued as
// JSON fails with it (raw HEX bytes still go out). To change the settings
// by downlink, use MY-L1-CO2-X1_encoder_chirpstack.js instead: it decodes
// the uplinks too.
// Use it on the CO2 device profile only: the heartbeat differs from the TH
// product (no error byte, CO2 added, 11 bytes).
// UPLINK ports:   0x02 heartbeat, 0x03 multi-sample, 0x04 trigger, 0x05 boot,
//                 0x10-0x17 config-ACK (echo of applied downlink)
// Values: temperature int16 x100, humidity uint16 x100, CO2 uint16 ppm.
//   A value the device could not read arrives as 0x8000 (temperature) or
//   0xFFFF (humidity, CO2) and is shown as "error".
// Parameters: 0 temperature, 1 humidity, 2 co2 (sampling also 3 = all)
// Adds both UTC and IST (+5:30) timestamps on uplinks.
// ===================================================================

var IST_OFFSET = 19800;   // +5:30 in seconds

var PARAM_NAMES    = ["temperature", "humidity", "co2"];
var PARAM_UNITS    = ["°C", "%RH", "ppm"];
var SAMPLING_NAMES = ["temperature", "humidity", "co2", "all"];
var TH_SENSOR      = ["not found", "SHT4x on STCC4", "SHT4x direct"];

// Shortest valid payload per uplink port (byte 10 of the boot frame is optional)
var MIN_LEN = { 2: 11, 3: 7, 4: 14, 5: 10, 16: 5, 17: 2, 18: 2, 19: 4,
                20: 10, 21: 4, 22: 5, 23: 6 };

// ---- helpers ----------------------------------------------------
function u32(b, i) {                         // big-endian uint32
  return ((b[i] << 24) | (b[i+1] << 16) | (b[i+2] << 8) | b[i+3]) >>> 0;
}
function u16(b, i) {                         // big-endian uint16
  return (b[i] << 8) | b[i+1];
}
function s16(b, i) {                         // big-endian signed int16
  var v = (b[i] << 8) | b[i+1];
  return (v & 0x8000) ? v - 0x10000 : v;
}
function pad(n) { return ("0" + n).slice(-2); }

function paramName(p)    { return (PARAM_NAMES[p]    !== undefined) ? PARAM_NAMES[p]    : "unknown_" + p; }
function samplingName(p) { return (SAMPLING_NAMES[p] !== undefined) ? SAMPLING_NAMES[p] : "unknown_" + p; }

// One value in its parameter's wire format; "error" for the not-read sentinel.
//   temperature int16 x100 (0x8000), humidity uint16 x100 (0xFFFF), CO2 uint16 ppm (0xFFFF)
function paramValue(param, b, i) {
  if (param === 0) {
    var t = s16(b, i);
    return (t === -32768) ? "error" : t / 100;
  }
  var v = u16(b, i);
  if (v === 0xFFFF) return "error";
  return (param === 1) ? v / 100 : v;
}

// Build an ISO-like string with explicit offset suffix.
function isoString(unixSec, offsetSec) {
  var d = new Date((unixSec + offsetSec) * 1000);
  var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
          pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" +
          pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  return offsetSec === 0 ? s + "Z" : s + "+05:30";
}

// Build a deviceInfo object with the time fields + battery + fPort.
function buildDeviceInfo(fPort, battery, unixUTC) {
  return {
    fPort:   fPort,
    battery: battery,
    unixUTC: unixUTC,
    timeUTC: isoString(unixUTC, 0),
    timeIST: isoString(unixUTC, IST_OFFSET)
  };
}

// ===================================================================
// UPLINK DECODER
// ===================================================================
function decodeUplink(input) {
  var b = input.bytes;
  var fPort = input.fPort;
  var data = {};

  if (MIN_LEN[fPort] !== undefined && b.length < MIN_LEN[fPort]) {
    return {
      data: { fPort: fPort, length: b.length },
      warnings: ["Payload too short for fPort " + fPort + " (" + b.length + " bytes)"]
    };
  }

  // ============ PORT 0x05 : BOOT UPLINK #1 (device info) ============
  // [0-2]firmware [3-5]hardware [6-9]UTC [10]sensors
  if (fPort === 0x05) {
    data.type = "boot";
    data.deviceInfo = buildDeviceInfo(fPort, null, u32(b, 6));   // UTC at byte 6
    delete data.deviceInfo.battery;                              // boot has no battery reading
    data.deviceInfo["Firmware Version"] = b[0] + "." + b[1] + "." + b[2];   // "1.0.0"
    data.deviceInfo["Hardware Version"] = b[3] + "." + b[4] + "." + b[5];   // "1.0.0"
    if (b.length > 10) {                     // bit0 STCC4 found, bits1-2 SHT4x placement
      data.deviceInfo["CO2 Sensor"] = (b[10] & 0x01) ? "STCC4" : "not found";
      var sht = (b[10] >> 1) & 0x03;
      data.deviceInfo["TH Sensor"] = (TH_SENSOR[sht] !== undefined) ? TH_SENSOR[sht] : "unknown";
    }
    return { data: data };
  }

  // ====== PORTS 0x10..0x17 : CONFIG ACK (echo of applied downlink) ======
  // Device re-sends on the SAME port the downlink used, echoing the values
  // now in force, then battery %. Numeric fields are shown as
  // human-readable strings (ON/OFF, CONFIRMED/..., ENABLED/...).
  if (fPort >= 0x10 && fPort <= 0x17) {
    var ack = { appliedPort: fPort };

    if (fPort === 0x10) {                    // interval u32 + batt
      ack.feature  = "tx_interval";
      ack.interval = u32(b, 0);
      ack.battery  = b[4];

    } else if (fPort === 0x11) {             // adr + batt
      ack.feature = "adr";
      ack.adr     = (b[0] === 1) ? "ON" : "OFF";
      ack.battery = b[1];

    } else if (fPort === 0x12) {             // msgtype + batt
      ack.feature = "msg_type";
      ack.msgtype = (b[0] === 1) ? "CONFIRMED" : "UNCONFIRMED";
      ack.battery = b[1];

    } else if (fPort === 0x13) {             // adr, SF, msgtype + batt
      ack.feature = "msg_info";
      ack.adr     = (b[0] === 1) ? "ON" : "OFF";
      ack.sf      = b[1];                    // firmware echoes SF directly (7..12)
      ack.msgtype = (b[2] === 1) ? "CONFIRMED" : "UNCONFIRMED";
      ack.battery = b[3];

    } else if (fPort === 0x14) {             // trig,param,min,max,ct,en + batt
      ack.feature   = "trigger";
      ack.trig      = b[0];
      ack.param     = paramName(b[1]);
      ack.unit      = PARAM_UNITS[b[1]];
      ack.min       = paramValue(b[1], b, 2); // CO2 in ppm, T/RH x100
      ack.max       = paramValue(b[1], b, 4);
      ack.checktime = u16(b, 6);
      ack.enable    = (b[8] === 1) ? "ENABLED" : "DISABLED";
      ack.battery   = b[9];

    } else if (fPort === 0x15) {             // param,count,en + batt
      ack.feature = "sampling";
      ack.param   = samplingName(b[0]);
      ack.count   = b[1];
      ack.enable  = (b[2] === 1) ? "ENABLED" : "DISABLED";
      ack.battery = b[3];

    } else if (fPort === 0x16) {             // co2 sample time, pressure + batt
      ack.feature     = "co2_config";
      ack.co2interval = u16(b, 0);           // seconds between CO2 shots
      var pr = u16(b, 2);
      ack.pressure    = (pr === 0) ? "OFF" : pr;   // hPa
      ack.battery     = b[4];

    } else {                                 // 0x17 FRC target, correction, status + batt
      ack.feature    = "co2_frc";
      ack.target     = u16(b, 0);            // ppm
      ack.correction = s16(b, 2);            // ppm applied by the sensor
      ack.status     = (b[4] === 0) ? "OK" : "FAILED";
      ack.battery    = b[5];
    }

    data.type = "config_ack";
    data.configAck = ack;
    return { data: data };
  }

  // ============ PORT 0x04 : TRIGGER ALARM / CLEAR (14 bytes, no header) ============
  // [0]trigNum [1]param [2]event
  // [3-4]value [5-6]min [7-8]max [9]battery [10-13]UTC
  // value/min/max use the param's format (CO2 in ppm, T/RH x100)
  if (fPort === 0x04) {
    data.type = "trigger";

    // --- device info ---
    data.deviceInfo = buildDeviceInfo(fPort, b[9], u32(b, 10));
    data.deviceInfo.trigNum = b[0];                        // 1 or 2
    data.deviceInfo.event   = (b[2] === 1) ? "ALARM" : "CLEAR";

    // --- sensor info ---
    data.sensorInfo = {
      param: paramName(b[1]),
      unit:  PARAM_UNITS[b[1]],
      value: paramValue(b[1], b, 3),
      min:   paramValue(b[1], b, 5),
      max:   paramValue(b[1], b, 7)
    };
    return { data: data };
  }

  // ============ PORT 0x02 : SINGLE READING (heartbeat, 11 bytes) ============
  // [0-1]temperature [2-3]humidity [4-5]CO2 [6]battery (bit7 = CO2 warm-up) [7-10]UTC
  if (fPort === 0x02) {
    data.type = "heartbeat";

    // --- device info ---
    data.deviceInfo = buildDeviceInfo(fPort, b[6] & 0x7F, u32(b, 7));

    // --- sensor info ---
    data.sensorInfo = {
      temperature: paramValue(0, b, 0),
      humidity:    paramValue(1, b, 2),
      co2:         paramValue(2, b, 4),
      co2Warmup:   (b[6] & 0x80) ? true : false   // first 360 shots after a battery change
    };
    return { data: data };
  }

  // ============ PORT 0x03 : MULTI-SAMPLE BATCH (variable width) ============
  // [0]count [1]param, samples (2 bytes per value; "all" = T,H,CO2), [n]battery, [n+1..n+4]UTC
  if (fPort === 0x03) {
    data.type = "sampling";

    var count = b[0];
    var param = b[1];                        // 0=temp, 1=hum, 2=co2, 3=all

    // walk the sample block first to locate battery + UTC at the end
    var samples = [];
    var idx = 2;
    for (var n = 0; n < count; n++) {
      var sObj = {};
      if (param === 0 || param === 3) { sObj.temperature = paramValue(0, b, idx); idx += 2; }
      if (param === 1 || param === 3) { sObj.humidity    = paramValue(1, b, idx); idx += 2; }
      if (param === 2 || param === 3) { sObj.co2         = paramValue(2, b, idx); idx += 2; }
      samples.push(sObj);
    }
    if (b.length < idx + 5) {
      return {
        data: { fPort: fPort, length: b.length },
        warnings: ["Sampling batch shorter than its " + count + " samples"]
      };
    }
    var battery = b[idx];     idx += 1;      // battery after sample block
    var unixUTC = u32(b, idx);               // one UTC stamp for the batch

    // --- device info ---
    data.deviceInfo = buildDeviceInfo(fPort, battery, unixUTC);

    // --- sensor info ---
    data.sensorInfo = {
      param:   samplingName(param),
      count:   count,
      samples: samples
    };
    return { data: data };
  }

  // ============ Unknown port ============
  return {
    data: { fPort: fPort },
    warnings: ["Unknown fPort " + fPort]
  };
}
