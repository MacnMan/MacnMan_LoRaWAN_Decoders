// ===================================================================
// MacSync MS_LPS_STD_X1 (RS485 / analog, DC powered) - standalone DOWNLINK ENCODER
// Same JSON keys and checks as the codec files in ../Decoder (those also hold
// this encoder). Put the FPort in the JSON as "port" (or "fPort").
// ===================================================================

// ===================================================================
// DOWNLINK ENCODER  (JSON -> bytes; "port" in the JSON = FPort)
//   Modbus (address is 1-based, as in the app):
//     8  {"port":8,"slaveId":1,"numReg":1,"address":1,"value":1}       // 1 coil: 0 OFF / 1 ON
//        {"port":8,"slaveId":1,"numReg":4,"address":1,"value":5}       // 2..32 coils: bitmask, bit0 = first coil
//     9  {"port":9,"slaveId":1,"numReg":1,"address":1,"value":1234}    // 1 register: -32768..65535
//        {"port":9,"slaveId":1,"numReg":2,"address":1,"value":70000}   // 32-bit, high word first
//        {"port":9,"slaveId":1,"numReg":2,"address":1,"value":1.5,"valueType":"float32"}
//          valueType: int32 | uint32 | float32 | int32_swapped | uint32_swapped | float32_swapped
//     10 {"port":10,"index":1,"slaveId":1,"fc":4,"enable":1,"dataType":1,"numParams":2,"address":1}
//        fields 1-2 also feed trigger/sampling: max 5 values there
//     12 {"port":12,"baud":9600,"parity":0}      // 1200..65535; parity 0 none 1 even 2 odd (omit = keep)
//     13 {"port":13,"slaveId":1,"fc":4,"dataType":1,"numParams":2,"address":1}
//        fc 1/2 (coils): use dataType 0 or 1; each value = 8 coils, bit0 = first coil
//     15 {"port":15,"index":1}
//   Config:
//     16 {"port":16,"interval":300}              // seconds, 10..86399
//     17 {"port":17,"adr":1}                     // node reboots ~9 s later
//     18 {"port":18,"msgtype":1}                 // 1 confirmed, 0 unconfirmed
//     19 {"port":19,"adr":1,"sf":7,"msgtype":1}  // or "dr":0..5; node reboots ~9 s later
//        optional "region":"AS923"|"AU915"|"US915" checks the DR range (US915: use "dr")
//     20 {"port":20,"trig":1,"param":0,"min":900,"max":1000,"checktime":30,"enable":1}
//        port 20 rewrites the whole trigger: always send all six fields.
//        min/max are sent as int32 x100 (13-byte downlink): 2 decimals, up to
//        +/-21474836.47. The node keeps them as float32 (about 7 digits).
//        checktime 5..65535 s. Current firmware clears a param 0
//        (Field 1 / Channel A) trigger at every reboot.
//     21 {"port":21,"param":2,"count":6,"enable":1,"interval":300}  // interval optional, 30..3600 s
//        param 0 Field 1 / Ch A, 1 Field 2 / Ch B, 2 both; count 2..12
//   Class: fixed Class C. Set the ChirpStack device profile to Class C too,
//        or downlinks wait for the next uplink.
// dataType: 0 int16, 1 uint16, 2 int32, 3 int32_swapped, 4 float32,
//           5 float32_swapped, 6 uint32_swapped, 7 uint32
// ===================================================================
function num(x) { return (typeof x === "string" && x !== "" && !isNaN(Number(x))) ? Number(x) : x; }
function isInt(v, lo, hi) { return typeof v === "number" && Math.floor(v) === v && v >= lo && v <= hi; }
function u16b(v) { return [(v >> 8) & 0xFF, v & 0xFF]; }
function u32b(v) { return [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]; }
function encodeError(msg) { return { bytes: [], errors: [msg] }; }

// float -> IEEE-754 float32 bits (for float register writes on port 9)
function f32bits(v) {
  if (isNaN(v)) { return 0x7FC00000; }
  var s = (v < 0 || (v === 0 && 1 / v < 0)) ? 1 : 0;
  v = Math.abs(v);
  if (v === 0) { return (s << 31) >>> 0; }
  if (v === Infinity) { return ((s << 31) | 0x7F800000) >>> 0; }
  var e = Math.floor(Math.log(v) / Math.LN2);
  if (v / Math.pow(2, e) >= 2) { e++; }
  if (v / Math.pow(2, e) < 1) { e--; }
  var m;
  if (e < -126) { m = Math.round(v / Math.pow(2, -149)); e = 0; }
  else {
    m = Math.round((v / Math.pow(2, e) - 1) * 0x800000);
    if (m === 0x800000) { m = 0; e++; }
    e += 127;
    if (e >= 255) { return ((s << 31) | 0x7F800000) >>> 0; }
  }
  return ((s << 31) | (e << 23) | m) >>> 0;
}

// Checks for an RS485 field (port 10) or a live read (port 13). "" = ok.
function fieldError(v, isFieldConfig) {
  if (isFieldConfig && !isInt(v.index, 1, 20)) { return "index 1..20"; }
  if (isFieldConfig && !isInt(v.enable, 0, 1)) { return "enable 0 or 1"; }
  if (!isInt(v.slaveId, 1, 255)) { return "slaveId 1..255 (0 is broadcast)"; }
  if (!isInt(v.fc, 1, 4)) { return "fc 1/2 (coils, inputs) or 3/4 (registers); use port 8/9 to write"; }
  if (!isInt(v.dataType, 0, 7)) { return "dataType 0..7"; }
  if (v.fc <= 2 && v.dataType > 1) { return "fc 1/2 (coils) needs dataType 0 or 1"; }
  var maxP;
  if (isFieldConfig) {
    // fields 1-2 feed trigger/sampling, whose firmware read refuses more than 5 values
    maxP = (v.index <= 2) ? 5 : ((v.dataType <= 1) ? 7 : 5);
  } else { maxP = (v.fc <= 2) ? 160 : ((v.dataType <= 1) ? 10 : 5); }
  if (!isInt(v.numParams, 1, maxP)) {
    return "numParams 1.." + maxP + ((isFieldConfig && v.index <= 2) ? " for fields 1-2 (used by trigger/sampling)" : "");
  }
  if (!isInt(v.address, 1, 65535)) { return "address is 1-based: 1..65535"; }
  return "";
}

function encodeDownlink(input) {
  var d = input.data || {};
  var v = {};
  for (var key in d) { if (Object.prototype.hasOwnProperty.call(d, key)) { v[key] = num(d[key]); } }
  var port = (v.port !== undefined) ? v.port : (v.fPort !== undefined) ? v.fPort : input.fPort;   // "port" or "fPort" key
  if (!isInt(port, 1, 223)) {
    return encodeError("put \"port\" in the JSON (ChirpStack v4 does not pass fPort to the codec)");
  }
  var bytes = [], err = "";
  switch (port) {
    // ---- Class switch: not available, the node is fixed to Class C ----
    case 3:
      return encodeError("the class is fixed (Class C) on this node; a class downlink is ignored");

    // ---- Modbus / RS485 ----
    case 8: {                                                     // coil write
      var n8 = (v.numReg === undefined) ? 1 : v.numReg;
      if (!isInt(v.slaveId, 1, 255)) { return encodeError("slaveId 1..255 (0 is broadcast)"); }
      if (!isInt(n8, 1, 32)) { return encodeError("numReg 1..32 coils"); }
      if (!isInt(v.address, 1, 65535)) { return encodeError("address is 1-based: 1..65535"); }
      if (n8 === 1) {
        var on = (v.value === true) ? 1 : (v.value === false) ? 0 : v.value;
        if (on !== 0 && on !== 1) { return encodeError("value 0 (OFF) or 1 (ON)"); }
        bytes = [v.slaveId, 1].concat(u16b(v.address)).concat(u16b(on));
      } else {
        var maxMask = Math.pow(2, n8) - 1;
        if (!isInt(v.value, 0, maxMask)) { return encodeError("value = coil bitmask 0.." + maxMask + " (bit0 = first coil)"); }
        bytes = [v.slaveId, n8].concat(u16b(v.address)).concat(u32b(v.value >>> 0));
      }
      break;
    }
    case 9: {                                                     // register write
      var n9 = (v.numReg === undefined) ? 1 : v.numReg;
      var vt = (v.valueType === undefined) ? "" : String(v.valueType);
      if (!isInt(v.slaveId, 1, 255)) { return encodeError("slaveId 1..255 (0 is broadcast)"); }
      if (n9 !== 1 && n9 !== 2) { return encodeError("numReg 1 (one 16-bit register) or 2 (32-bit, high word first)"); }
      if (!isInt(v.address, 1, 65535)) { return encodeError("address is 1-based: 1..65535"); }
      if (typeof v.value !== "number" || !isFinite(v.value)) { return encodeError("value must be a number"); }
      if (n9 === 1) {
        if (!isInt(v.value, -32768, 65535)) { return encodeError("value -32768..65535 for one register"); }
        bytes = [v.slaveId, 1].concat(u16b(v.address)).concat(u16b(v.value & 0xFFFF));
      } else {
        var raw;
        if (vt === "float32" || vt === "float32_swapped") {
          raw = f32bits(v.value);
        } else if (vt === "" || vt === "int32" || vt === "uint32" || vt === "int32_swapped" || vt === "uint32_swapped") {
          if (!isInt(v.value, -2147483648, 4294967295)) { return encodeError("value must be a 32-bit integer (or set valueType float32)"); }
          raw = v.value >>> 0;
        } else {
          return encodeError("valueType: int32, uint32, float32, int32_swapped, uint32_swapped or float32_swapped");
        }
        if (vt.indexOf("_swapped") > 0) { raw = (((raw & 0xFFFF) << 16) | (raw >>> 16)) >>> 0; }
        bytes = [v.slaveId, 2].concat(u16b(v.address)).concat(u32b(raw));
      }
      break;
    }
    case 10:                                                      // field config
      err = fieldError(v, true);
      if (err) { return encodeError(err); }
      bytes = [v.index, v.slaveId, v.fc, v.enable, v.dataType, v.numParams].concat(u16b(v.address));
      break;
    case 12: {                                                    // baud + parity
      // sent as 16 bits: 1200..65535 (e.g. 9600, 19200, 38400, 57600)
      if (!isInt(v.baud, 1200, 65535)) {
        return encodeError("baud 1200..65535 over LoRa (115200 only over BLE: AT+BAUD)");
      }
      var par = (v.parity === undefined) ? 0xFF : v.parity;  // 0xFF = keep current parity
      if (par !== 0 && par !== 1 && par !== 2 && par !== 0xFF) {
        return encodeError("parity 0 none, 1 even, 2 odd (leave out to keep the current one)");
      }
      bytes = u16b(v.baud).concat([par]);
      break;
    }
    case 13:                                                      // live register read
      err = fieldError(v, false);
      if (err) { return encodeError(err); }
      bytes = [v.slaveId, v.fc, v.dataType, v.numParams].concat(u16b(v.address));
      break;
    case 15:                                                      // field read-back
      if (!isInt(v.index, 1, 20)) { return encodeError("index 1..20"); }
      bytes = [v.index];
      break;

    // ---- Config ----
    case 16:                                                      // TX interval
      if (!isInt(v.interval, 10, 86399)) { return encodeError("interval 10..86399 s"); }
      bytes = u32b(v.interval);
      break;
    case 17:                                                      // ADR
      if (!isInt(v.adr, 0, 1)) { return encodeError("adr 0 or 1"); }
      bytes = [v.adr];
      break;
    case 18:                                                      // msg type
      if (!isInt(v.msgtype, 0, 1)) { return encodeError("msgtype 0 unconfirmed or 1 confirmed"); }
      bytes = [v.msgtype];
      break;
    case 19: {                                                    // adr + sf + type
      if (!isInt(v.adr, 0, 1)) { return encodeError("adr 0 or 1"); }
      if (!isInt(v.msgtype, 0, 1)) { return encodeError("msgtype 0 or 1"); }
      var region = (v.region === undefined) ? "" : String(v.region).toUpperCase();
      if (region === "US915" && v.dr === undefined) { return encodeError("US915: give dr 0..4 (sf does not map to DR there)"); }
      var dr = (v.dr !== undefined) ? v.dr : (v.sf !== undefined) ? 12 - v.sf : NaN;
      // AS923/AU915 (uplink dwell time on) start at DR2; US915 uplink stops at DR4
      var minDr = (region === "AS923" || region === "AU915") ? 2 : 0, maxDr = (region === "US915") ? 4 : 5;
      if (!isInt(dr, minDr, maxDr)) {
        return encodeError("give sf " + (12 - maxDr) + ".." + (12 - minDr) + " or dr " + minDr + ".." + maxDr + (region ? " for " + region : ""));
      }
      bytes = [v.adr, 12 - dr, v.msgtype];
      break;
    }
    case 20: {                                                    // trigger
      if (v.trig === undefined || v.param === undefined || typeof v.min !== "number" || typeof v.max !== "number" ||
          v.checktime === undefined || v.enable === undefined) {
        return encodeError("port 20 rewrites the whole trigger: send trig, param, min, max, checktime and enable");
      }
      if (!isInt(v.trig, 1, 2)) { return encodeError("trig 1 or 2"); }
      if (!isInt(v.param, 0, 1)) { return encodeError("param 0 (Field 1 / Channel A) or 1 (Field 2 / Channel B)"); }
      var mn = Math.round(v.min * 100), mx = Math.round(v.max * 100);
      if (!(mn >= -2147483648 && mn <= 2147483647 && mx >= -2147483648 && mx <= 2147483647)) {
        return encodeError("min/max -21474836.48..21474836.47 (sent as int32 x100)");
      }
      if (mn > mx) { return encodeError("min must be <= max"); }
      if (!isInt(v.checktime, 5, 65535)) { return encodeError("checktime 5..65535 s"); }
      if (!isInt(v.enable, 0, 1)) { return encodeError("enable 0 or 1"); }
      // 13 bytes: trig, param, min (4), max (4), checktime (2), enable
      bytes = [v.trig, v.param].concat(u32b(mn)).concat(u32b(mx))
              .concat(u16b(v.checktime)).concat([v.enable]);
      break;
    }
    case 21: {                                                    // sampling
      if (!isInt(v.param, 0, 2)) { return encodeError("param 0 (Field 1 / Ch A), 1 (Field 2 / Ch B) or 2 (both)"); }
      if (!isInt(v.count, 2, 12)) { return encodeError("count 2..12"); }
      if (!isInt(v.enable, 0, 1)) { return encodeError("enable 0 or 1"); }
      bytes = [v.param, v.count, v.enable];
      if (v.interval !== undefined) {
        if (!isInt(v.interval, 30, 3600)) { return encodeError("interval 30..3600 s"); }
        bytes = bytes.concat(u16b(v.interval));
      }
      // Batch uplink size: both fields = 10 + 8 x count bytes, one field = 9 + 4 x count.
      // Above 51 bytes it only fits at DR3 or faster (SF9..SF7); at SF10-SF12 the
      // node drops the batch. Not checked here: any count 2..12 is sent.
      break;
    }
    default:
      return encodeError("unknown downlink port " + port);
  }
  return { bytes: bytes, fPort: port };
}
