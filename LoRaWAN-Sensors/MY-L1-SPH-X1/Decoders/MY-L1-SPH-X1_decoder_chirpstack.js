// ===================================================================
// ChirpStack v4 Codec - MY-L1-SPH-X1 soil pH node
// (RS485 JXCT JXBS-3001-PH-RS probe, firmware V1.0)
// Device profile -> Codec -> JavaScript functions: paste the whole file.
// UPLINK DECODER ONLY: there is no encodeDownlink, so a downlink sent as
// JSON cannot be encoded with this file. For downlinks use
// Encoders/MY-L1-SPH-X1_encoder_chirpstack.js (uplinks + downlinks).
// UPLINK ports: 0x02 heartbeat (live pH), 0x03 sampling, 0x04 trigger,
//               0x05 boot, 0x10-0x16 config-ACK, 12 RS485 baud reply
// Output shape:
//   type       : heartbeat | sampling | trigger | boot | config_ack | modbus_ack
//   deviceInfo : { fPort, source, battery, unixUTC, timeUTC, timeIST, ... }
//   sensorInfo : { ph, status } | { param, count, samples } | { param, value, min, max }
//   configAck / modbusAck : the setting the device now holds
// ===================================================================

var IST_OFFSET = 19800;   // +5:30 in seconds

// ---- byte helpers ----------------------------------------------
function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
function i16(b, i) { var v = u16(b, i); return (v & 0x8000) ? v - 0x10000 : v; }
function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
function pad(n) { return ("0" + n).slice(-2); }
function onOff(v) { return (v === 1) ? "ON" : "OFF"; }
function confirmedText(v) { return (v === 1) ? "CONFIRMED" : "UNCONFIRMED"; }
function enabledText(v) { return (v === 1) ? "ENABLED" : "DISABLED"; }
function stateText(s) { return (s === 0) ? "ok" : (s === 2) ? "invalid" : "failed"; }
var PARITY = ["none", "even", "odd"];

// "V1.0", or "V1.0.1" when the third number is used - as AT+DEVINFO shows it
function versionText(b, i) {
  return "V" + b[i] + "." + b[i + 1] + (b[i + 2] ? "." + b[i + 2] : "");
}

// ISO string with explicit offset; "not synced" when time is 0.
function isoString(unixSec, offsetSec) {
  if (!unixSec) { return "not synced"; }
  var d = new Date((unixSec + offsetSec) * 1000);
  var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
          pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" +
          pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  return offsetSec === 0 ? s + "Z" : s + "+05:30";
}

// Common deviceInfo block. source / battery null = left out (boot and the
// RS485 reply carry no battery).
function buildDeviceInfo(fPort, source, battery, unixUTC) {
  var di = { fPort: fPort };
  if (source !== null) { di.source = source; }
  if (battery !== null) { di.battery = battery; }
  di.unixUTC = unixUTC;
  di.timeUTC = isoString(unixUTC, 0);
  di.timeIST = isoString(unixUTC, IST_OFFSET);
  return di;
}

function shortPayload(fPort) {
  return { data: { type: "error", fPort: fPort, error: "short payload" } };
}

// ===================================================================
// UPLINK DECODER
// ===================================================================
function decodeUplink(input) {
  var b = input.bytes;
  var fPort = input.fPort;
  var data = {};

  // ---------- Port 0x02 : heartbeat (live soil pH) ----------
  // [0]=0x01 type [1]=0x00 source (RS485) [2]=tag:
  //   0x21 = one uint16 follows: [3-4] pH x100
  //   0xE0 = the probe read failed, no value
  // then battery(1B) + UTC(4B)
  if (fPort === 0x02) {
    var ok = (b[2] === 0x21);
    var p = ok ? 5 : 3;
    if (b.length < p + 5) { return shortPayload(fPort); }
    data.type = "heartbeat";
    data.deviceInfo = buildDeviceInfo(fPort, "rs485", b[p], u32(b, p + 1));
    if (ok) {
      data.sensorInfo = { ph: u16(b, 3) / 100, status: "ok" };
    } else {
      data.sensorInfo = { ph: null, status: ((b[2] >> 5) === 7) ? "read_error" : "unknown_tag" };
    }
    return { data: data };
  }

  // ---------- Port 0x03 : sampling batch ----------
  // [0]count [1]source (0x00 RS485) [2]field (0x01 pH) [3]type (0x01 uint16)
  // [4..] count x uint16 pH x100, oldest first (0xFFFF = that read failed)
  // then battery(1B) + UTC(4B)
  if (fPort === 0x03) {
    var n = b[0];
    var q = 4 + 2 * n;
    if (b.length < q + 5) { return shortPayload(fPort); }
    var samples = [];
    for (var s = 0; s < n; s++) {
      var v = u16(b, 4 + 2 * s);
      samples.push((v === 0xFFFF) ? null : v / 100);
    }
    data.type = "sampling";
    data.deviceInfo = buildDeviceInfo(fPort, "rs485", b[q], u32(b, q + 1));
    data.sensorInfo = { param: "pH", count: n, samples: samples };
    return { data: data };
  }

  // ---------- Port 0x04 : trigger alarm / clear ----------
  // [0]trig [1]param (0x00 pH) [2]event [3-4]value [5-6]min [7-8]max
  // [9]battery [10-13]UTC [14]source (0x00 RS485); values int16 / 100
  if (fPort === 0x04) {
    if (b.length < 14) { return shortPayload(fPort); }
    data.type = "trigger";
    data.deviceInfo = buildDeviceInfo(fPort, "rs485", b[9], u32(b, 10));
    data.deviceInfo.trigNum = b[0];
    data.deviceInfo.event = (b[2] === 1) ? "ALARM" : "CLEAR";
    data.sensorInfo = {
      param: "pH",
      value: i16(b, 3) / 100,
      min:   i16(b, 5) / 100,
      max:   i16(b, 7) / 100
    };
    return { data: data };
  }

  // ---------- Port 0x05 : boot info (no battery) ----------
  if (fPort === 0x05) {
    if (b.length < 10) { return shortPayload(fPort); }
    data.type = "boot";
    data.deviceInfo = buildDeviceInfo(fPort, null, null, u32(b, 6));
    data.deviceInfo["Firmware Version"] = versionText(b, 0);
    data.deviceInfo["Hardware Version"] = versionText(b, 3);
    return { data: data };
  }

  // ---------- Ports 0x10-0x16 : config ACK (echo of the applied downlink) ----------
  // The setting now stored, same bytes as the downlink, then battery.
  if (fPort >= 0x10 && fPort <= 0x16) {
    var ack = { appliedPort: fPort };
    if (fPort === 0x10) {
      ack.feature = "tx_interval"; ack.interval = u32(b, 0); ack.battery = b[4];
    } else if (fPort === 0x11) {
      ack.feature = "adr"; ack.adr = onOff(b[0]); ack.battery = b[1];
    } else if (fPort === 0x12) {
      ack.feature = "msg_type"; ack.msgtype = confirmedText(b[0]); ack.battery = b[1];
    } else if (fPort === 0x13) {
      ack.feature = "msg_info"; ack.adr = onOff(b[0]); ack.sf = b[1];
      ack.msgtype = confirmedText(b[2]); ack.battery = b[3];
    } else if (fPort === 0x14) {      // trig, param, min, max, checktime, enable, source
      ack.feature = "trigger"; ack.trig = b[0]; ack.param = "pH"; ack.source = "rs485";
      ack.min = i16(b, 2) / 100; ack.max = i16(b, 4) / 100;
      ack.checktime = u16(b, 6); ack.enable = enabledText(b[8]); ack.battery = b[10];
    } else if (fPort === 0x15) {      // param, count, enable, source, interval
      ack.feature = "sampling"; ack.param = "pH"; ack.source = "rs485";
      ack.count = b[1]; ack.enable = enabledText(b[2]);
      ack.interval = u16(b, 4); ack.battery = b[6];
    } else {                          // 0x16 pH probe: slave, fc, register, offset, divisor
      ack.feature = "ph_config"; ack.slaveId = b[0]; ack.fc = b[1];
      ack.register = u16(b, 2); ack.offset = i16(b, 4) / 100;
      ack.divisor = b[6]; ack.battery = b[7];
    }
    data.type = "config_ack";
    data.configAck = ack;
    return { data: data };
  }

  // ---------- Port 12 : RS485 baud / parity downlink reply ----------
  // [0]=0x02 [1]=0x02 [2]=0x0C [3]state (0 ok, 1 baud refused)
  // [4-5]baud [6]parity as requested (> 2 = left unchanged) [7-10]UTC
  if (fPort === 12) {
    if (b.length < 11) { return shortPayload(fPort); }
    data.type = "modbus_ack";
    data.deviceInfo = buildDeviceInfo(fPort, null, null, u32(b, b.length - 4));
    data.modbusAck = {
      state: b[3],
      state_text: stateText(b[3]),
      feature: "baud",
      baud: u16(b, 4),
      parity: b[6],
      parity_text: PARITY[b[6]] || "unchanged"
    };
    return { data: data };
  }

  // ---------- Unknown port ----------
  return { data: { fPort: fPort }, warnings: ["Unknown fPort " + fPort] };
}

// ChirpStack v3 compatibility - delete if you are on v4
function Decode(fPort, bytes, variables) {
  return decodeUplink({ bytes: bytes, fPort: fPort }).data;
}
