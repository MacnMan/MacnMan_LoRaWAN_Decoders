// ===================================================================
// TTN (The Things Network) Codec - MY-L1-SPH-X1 soil pH node
// (RS485 JXCT JXBS-3001-PH-RS probe, firmware V1.0)
// Same decodeUplink / encodeDownlink API as ChirpStack v4. Paste it into
// both the Uplink and the Downlink payload formatter.
// UPLINK DECODER + DOWNLINK ENCODER (uplink-only version:
// Decoders/MY-L1-SPH-X1_decoder_ttn.js).
// UPLINK ports: 0x02 heartbeat (live pH), 0x03 sampling, 0x04 trigger,
//               0x05 boot, 0x10-0x16 config-ACK, 12 RS485 baud reply
// DOWNLINK ports (encodeDownlink): 16 tx-interval, 17 adr, 18 msgtype,
//               19 msginfo, 20 trigger, 21 sampling, 22 pH probe,
//               12 RS485 baud, 3 class
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

// ===================================================================
// DOWNLINK ENCODER  (JSON -> bytes; set "port" in the JSON = FPort field)
//   16 {"port":16,"interval":3600}                   60 - 86400 s
//   17 {"port":17,"adr":1}                           the device restarts
//   18 {"port":18,"msgtype":0}                       0 unconfirmed, 1 confirmed
//   19 {"port":19,"adr":0,"sf":9,"msgtype":0}        SF 7 - 12; the device restarts
//   20 {"port":20,"trig":1,"param":0,"min":5.5,"max":7.5,"checktime":600,"enable":1}
//                                                    pH 0 - 14, min <= max, 30 - 65535 s
//   21 {"port":21,"param":0,"count":12,"enable":1,"interval":300}
//                                                    count 2 - 12, interval 30 - 3600 s (optional)
//   22 {"port":22,"slaveId":1,"fc":3,"register":6,"offset":-0.15,"divisor":100}
//                                                    pH probe; every key optional (a missing
//                                                    one keeps its value), divisor needs offset
//   12 {"port":12,"baud":9600,"parity":0}            baud 1200 - 57600, parity optional
//   3  {"port":3,"class":"A"}
// "param" is always 0 (pH) and may be left out. On/off keys also take
// true / false, "ON" / "OFF", "ENABLED" / "DISABLED", "CONFIRMED" / ...
// A missing or out-of-range value returns "errors" and no bytes.
// ===================================================================
function dlFail(msg) { throw new Error(msg); }
function dlHas(d, key) { return d[key] !== undefined && d[key] !== null && d[key] !== ""; }

function dlNumber(d, key, lo, hi) {
  if (!dlHas(d, key)) { dlFail('missing "' + key + '"'); }
  var v = Number(d[key]);
  if (isNaN(v) || v < lo || v > hi) { dlFail('"' + key + '" must be ' + lo + ' - ' + hi + ', got ' + d[key]); }
  return v;
}

function dlWhole(d, key, lo, hi) {
  var v = dlNumber(d, key, lo, hi);
  if (Math.floor(v) !== v) { dlFail('"' + key + '" must be a whole number, got ' + d[key]); }
  return v;
}

function dlFlag(d, key) {
  if (!dlHas(d, key)) { dlFail('missing "' + key + '"'); }
  var v = String(d[key]).toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "enabled" || v === "confirmed") { return 1; }
  if (v === "0" || v === "false" || v === "off" || v === "disabled" || v === "unconfirmed") { return 0; }
  dlFail('"' + key + '" must be 0 or 1, got ' + d[key]);
}

function dlParamPh(d) {   // the only parameter on this node
  if (dlHas(d, "param") && Number(d.param) !== 0) { dlFail('"param" must be 0 (pH), got ' + d.param); }
  return 0;
}

function be16(v) { return [(v >> 8) & 0xFF, v & 0xFF]; }
function be32(v) { return [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]; }
function x100(v) { return be16(Math.round(v * 100) & 0xFFFF); }   // int16, value x 100

var DOWNLINK = {
  16: function (d) {                                    // reporting interval
    return be32(dlWhole(d, "interval", 60, 86400));
  },
  17: function (d) {                                    // ADR (restart)
    return [dlFlag(d, "adr")];
  },
  18: function (d) {                                    // message type
    return [dlFlag(d, "msgtype")];
  },
  19: function (d) {                                    // ADR + SF + type (restart)
    return [dlFlag(d, "adr"), dlWhole(d, "sf", 7, 12), dlFlag(d, "msgtype")];
  },
  20: function (d) {                                    // trigger
    var trig = dlWhole(d, "trig", 1, 2);
    var param = dlParamPh(d);
    var mn = dlNumber(d, "min", 0, 14);
    var mx = dlNumber(d, "max", 0, 14);
    if (mn > mx) { dlFail('"min" (' + mn + ') is above "max" (' + mx + '): the device refuses it'); }
    return [trig, param].concat(x100(mn), x100(mx),
      be16(dlWhole(d, "checktime", 30, 65535)), [dlFlag(d, "enable")]);
  },
  21: function (d) {                                    // sampling
    var bytes = [dlParamPh(d), dlWhole(d, "count", 2, 12), dlFlag(d, "enable")];
    if (dlHas(d, "interval")) { bytes = bytes.concat(be16(dlWhole(d, "interval", 30, 3600))); }
    return bytes;
  },
  22: function (d) {                                    // pH probe map / calibration
    // slaveId / fc 0 and register 0xFFFF tell the device to keep the stored
    // value. The offset has no such value, so it is sent only when given -
    // and the divisor byte comes after it.
    if (!dlHas(d, "slaveId") && !dlHas(d, "fc") && !dlHas(d, "register") &&
        !dlHas(d, "offset") && !dlHas(d, "divisor")) {
      dlFail('nothing to set: give slaveId, fc, register, offset and / or divisor');
    }
    var bytes = [dlHas(d, "slaveId") ? dlWhole(d, "slaveId", 1, 247) : 0,
                 dlHas(d, "fc") ? dlWhole(d, "fc", 3, 4) : 0]
      .concat(be16(dlHas(d, "register") ? dlWhole(d, "register", 0, 0xFFFE) : 0xFFFF));
    if (dlHas(d, "offset")) { bytes = bytes.concat(x100(dlNumber(d, "offset", -2, 2))); }
    if (dlHas(d, "divisor")) {
      var div = Number(d.divisor);
      if (div !== 1 && div !== 10 && div !== 100) { dlFail('"divisor" must be 1, 10 or 100, got ' + d.divisor); }
      if (!dlHas(d, "offset")) {
        dlFail('"divisor" needs "offset" in the same downlink (the device cannot keep the offset): send the current offset, e.g. 0');
      }
      bytes.push(div);
    }
    return bytes;
  },
  12: function (d) {                                    // RS485 baud + parity
    var baud = dlWhole(d, "baud", 1200, 115200);
    if (baud > 0xFFFF) { dlFail('baud ' + baud + ' does not fit this 16-bit downlink (max 57600): set it with AT+BAUD'); }
    var parity = 0xFF;                                  // > 2: keep the stored parity
    if (dlHas(d, "parity")) {
      parity = PARITY.indexOf(String(d.parity).toLowerCase());
      if (parity < 0) { parity = [0, 1, 2].indexOf(Number(d.parity)); }
      if (parity < 0) { dlFail('"parity" must be 0 (none), 1 (even) or 2 (odd), got ' + d.parity); }
    }
    return be16(baud).concat([parity]);
  },
  3: function (d) {                                     // device class
    var c = String(dlHas(d, "class") ? d["class"] : "").toUpperCase();
    if (c === "A" || c === "0") { return [0]; }
    if (c === "B" || c === "1") { dlFail("class B is not built into this firmware"); }
    if (c === "C" || c === "2") {
      dlFail("class C is refused on this battery node, as AT+CLASS does: the receiver would stay on (~5.7 mA, ~137 mAh a day)");
    }
    dlFail('"class" must be "A"');
  }
};

function encodeDownlink(input) {
  var d = input.data || {};
  // ChirpStack does not reliably pass input.fPort here, so read "port" from
  // the JSON first (set it equal to the FPort field), fall back to input.fPort.
  var port = Number((d.port !== undefined) ? d.port :
                    (d.fPort !== undefined) ? d.fPort : input.fPort);
  try {
    if (!DOWNLINK[port]) { dlFail("unknown downlink port " + port + ": use 3, 12 or 16 - 22"); }
    return { bytes: DOWNLINK[port](d), fPort: port };
  } catch (e) {
    return { bytes: [], fPort: port, errors: [e.message] };
  }
}
