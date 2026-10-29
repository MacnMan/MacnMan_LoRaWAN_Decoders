// ===================================================================
// Milesight gateway built-in NS codec - MacSync MS_LPS_STD_X1 (LoRaWAN, DC powered, Class C)
// Milesight (UG63/UG65/UG67) embedded NS is ChirpStack v3 based:
//   decoder box entry point : Decode(fPort, bytes)   (wrapper at end of file)
//   encoder box entry point : Encode(fPort, obj)     (wrapper at end of file)
// Paste this WHOLE file into BOTH the decoder and encoder boxes.
// RS485/Modbus OR 2-channel analog (4-20mA / 0-10V / digital), set by AT+DEVTYPE.
// Same payload layout as MS_LBS_STD_X1. The byte that carried battery % on
// the battery node is always 0xFF on this node -> reported as power:"external".
// One difference: trigger numbers (value, min, max) are int32 x100 (4 bytes)
// on this node, so they are not limited to 327.67. The battery node's int16
// frames are still decoded - the two are told apart by their length.
//
// UPLINK ports: 0x02 heartbeat (also boot #2 and AT+UP), 0x03 sampling,
//               0x04 trigger, 0x05 boot, 0x10-0x15 config echo,
//               8/9/10/12/13/15 RS485/Modbus downlink replies
// DOWNLINK ports (encodeDownlink) - always put "port" in the JSON:
//   Modbus : 8 coil-write, 9 reg-write, 10 field-config, 12 baud,
//            13 reg-read, 15 field-read
//   Config : 16 tx-interval, 17 adr, 18 msgtype, 19 msginfo,
//            20 trigger, 21 sampling
//   The class is fixed (Class C): there is no class downlink.
// Output shape:
//   type       : heartbeat | sampling | trigger | boot | config_ack | modbus_ack | error
//   deviceInfo : { fPort, model, source, power, unixUTC, timeUTC, timeIST, timeSynced, ... }
//   sensorInfo : readings ; configAck / modbusAck : reply details
//   warnings   : inside data (ChirpStack v4 drops top-level warnings)
// ===================================================================

var MODEL = "MY_L3_CV_X1";
var IST_OFFSET = 19800;            // +5:30 in seconds
var MIN_VALID_UTC = 1577836800;    // 2020-01-01. Below this the node clock is not synced yet
var EXT_POWER = 0xFF;              // LPS sends 0xFF where the battery node sends battery %

// ---- byte helpers ----------------------------------------------
function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
function i16(b, i) { var v = u16(b, i); return (v & 0x8000) ? v - 0x10000 : v; }
function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i+1] << 16) + (b[i+2] << 8) + b[i+3]; }
function i32(b, i) { return u32(b, i) | 0; }
function u32sw(b, i) { return ((b[i+2] << 24) >>> 0) + (b[i+3] << 16) + (b[i] << 8) + b[i+1]; } // word-swapped (CDAB)
function pad(n) { return ("0" + n).slice(-2); }
function fx2(v) { return v.toFixed(2); }                 // 5 -> "5.00"
function num2(v) { return Math.round(v * 100) / 100; }   // 8.2213 -> 8.22 (number)
// float32 -> shortest decimal that gives back the same float32 (47.2, not 47.20000076); NaN -> null
function r7(v) {
  if (!isFinite(v)) { return null; }
  for (var p = 7; p < 9; p++) { var s = parseFloat(v.toPrecision(p)); if (f32bits(s) === f32bits(v)) { return s; } }
  return parseFloat(v.toPrecision(9));
}
function chAB(n) { return (n === 1) ? "A" : (n === 2) ? "B" : ("" + n); }
function stateText(s) { return (s === 0) ? "ok" : (s === 2) ? "invalid" : "failed"; }
function decodeError(msg) { return { data: { type: "error", error: msg } }; }

// IEEE-754 float32 by hand (works on every ChirpStack JS runtime)
function f32(u) {
  var sign = (u >>> 31) ? -1 : 1;
  var exp  = (u >>> 23) & 0xFF;
  var man  = u & 0x7FFFFF;
  if (exp === 0)   { return sign * man * Math.pow(2, -149); }
  if (exp === 255) { return man ? NaN : sign * Infinity; }
  return sign * (man + 0x800000) * Math.pow(2, exp - 150);
}

// ISO string with explicit offset. Before the network time arrives the node
// sends seconds since power-up, so anything before 2020 is "not synced".
function isoString(unixSec, offsetSec) {
  if (!unixSec || unixSec < MIN_VALID_UTC) { return "not synced"; }
  var d = new Date((unixSec + offsetSec) * 1000);
  var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
          pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" +
          pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  return offsetSec === 0 ? s + "Z" : s + "+05:30";
}

// 0xFF = external (DC) power. Any other value would be a battery node.
function setPower(o, v) {
  if (v === EXT_POWER) { o.power = "external"; }
  else if (v !== null && v !== undefined) { o.battery = v; }
}

// Common deviceInfo block. source / powerByte may be null (boot and Modbus replies carry none).
function buildDeviceInfo(fPort, source, powerByte, unixUTC) {
  var di = { fPort: fPort, model: MODEL };
  if (source !== null && source !== undefined) { di.source = source; }
  setPower(di, powerByte);
  di.unixUTC = unixUTC;
  di.timeUTC = isoString(unixUTC, 0);
  di.timeIST = isoString(unixUTC, IST_OFFSET);
  di.timeSynced = (unixUTC >= MIN_VALID_UTC);
  return di;
}

var TYPE_NAME = ["int16", "uint16", "int32", "int32_swapped",
                 "float32", "float32_swapped", "uint32_swapped", "uint32"];
// analog mode: 1 = 4-20mA, 2 = 0-10V, 3 = digital (0-10V input, HIGH above 1.8 V)
var ANALOG_MODE = ["off", "4-20mA", "0-10V", "digital"];

function decodeValue(type, b, i) {
  switch (type) {
    case 0: return i16(b, i);
    case 1: return u16(b, i);
    case 2: return (u32(b, i) | 0);
    case 3: return (u32sw(b, i) | 0);
    case 4: return r7(f32(u32(b, i)));
    case 5: return r7(f32(u32sw(b, i)));
    case 6: return u32sw(b, i);
    case 7: return u32(b, i);
  }
  return null;
}

// Sampling value: analog mA / V as 2-decimal strings, digital is 0/1,
// RS485 float32 keeps its float value, RS485 integer types stay exact.
function fmtSample(src, t, v) {
  if (!isFinite(v)) { return null; }
  if (src === 1) {
    if (t === 3) { return (v >= 0.5) ? 1 : 0; }
    return fx2(v);
  }
  if (t === 4 || t === 5) { return r7(v); }
  return v;
}

// Analog heartbeat: returns {channels, power, unixUTC}. Starts at byte 2.
function decodeAnalogChannels(b) {
  var i = 2, chans = [];
  for (var ch = 1; ch <= 2; ch++) {
    if (i >= b.length) { break; }
    var chLabel = chAB(ch);
    var t = b[i++];
    if (t === 0) {
      chans.push({ channel: chLabel, sensor_type: "off", status: "not_configured" });
      continue;
    }
    if (t > 3 || i + 2 > b.length) {
      chans.push({ channel: chLabel, sensor_type: "invalid", status: "bad_type", type_raw: t });
      continue;
    }
    var val = u16(b, i) / 1000; i += 2;          // firmware sends value x1000
    var o = { channel: chLabel, sensor_type: ANALOG_MODE[t], status: "ok" };
    if (t === 1) {                                // 4-20 mA
      o.current_mA = num2(val);
      if (val < 3.5)  { o.fault = "under_range"; }
      if (val > 20.5) { o.fault = "over_range";  }
    } else if (t === 2) {                         // 0-10 V
      o.voltage_V = num2(val);
    } else if (t === 3) {                         // digital 0/1
      o.digital = (val >= 0.5) ? 1 : 0;
      o.state   = (val >= 0.5) ? "HIGH" : "LOW";
    }
    chans.push(o);
  }
  var power = (i < b.length) ? b[i++] : null;
  var unixUTC = (i + 4 <= b.length) ? u32(b, i) : 0;
  return { channels: chans, power: power, unixUTC: unixUTC };
}

// Modbus downlink-reply deviceInfo: UTC is the last 4 bytes, no power byte.
function modbusDeviceInfo(fPort, b) {
  return buildDeviceInfo(fPort, null, null, u32(b, b.length - 4));
}

// ===================================================================
// UPLINK DECODER
// ===================================================================
function decodeUplink(input) {
  var b = input.bytes;
  var fPort = input.fPort;
  var data = {};

  // ---------- Port 0x02 : heartbeat (RS485 or analog) ----------
  // [0]=0x01 [1]=0 RS485 / 1 analog ... [len-5]=0xFF power [len-4..]=UTC
  if (fPort === 0x02) {
    if (b.length < 9) { return decodeError("short payload"); }

    if (b[1] === 1) {                          // ---- analog ----
      var a = decodeAnalogChannels(b);
      data.type = "heartbeat";
      data.deviceInfo = buildDeviceInfo(fPort, "analog", a.power, a.unixUTC);
      data.sensorInfo = { channels: a.channels };
      return { data: data };
    }

    // ---- RS485 field sweep: one tag per field 1..20 ----
    // tag = type(3 bits) | count(5 bits); 0xC0 disabled, 0xE0 read error
    var end = b.length - 5;
    var i = 2, slot = 1, flds = [], ok = 0, off = 0, failed = 0;
    while (i < end) {
      var tag = b[i++];
      var type = (tag >> 5) & 0x07;
      var cnt  = tag & 0x1F;
      if (cnt === 0) {
        if (type === 6)      { flds.push({ field: slot++, status: "disabled" });   off++;    }
        else if (type === 7) { flds.push({ field: slot++, status: "read_error" }); failed++; }
        else                 { flds.push({ field: slot++, status: "empty" }); }
        continue;
      }
      var width = (type <= 1) ? 2 : 4;
      var vals = [];
      for (var k = 0; k < cnt; k++) {
        if (i + width > end) { break; }
        vals.push(decodeValue(type, b, i));
        i += width;
      }
      flds.push({ field: slot++, status: "ok", data_type: TYPE_NAME[type], values: vals });
      ok++;
    }
    data.type = "heartbeat";
    data.deviceInfo = buildDeviceInfo(fPort, "rs485", b[b.length - 5], u32(b, b.length - 4));
    data.sensorInfo = { fields: flds, fields_ok: ok, fields_off: off, fields_failed: failed };
    if (slot - 1 < 20) {
      data.warnings = ["only " + (slot - 1) + " of 20 fields fit in this frame"];
    }
    return { data: data };
  }

  // ---------- Port 0x03 : sampling batch ----------
  // [0]=count [1]=0 RS485 / 1 analog [2]=0 both or 1/2 single [3..]=type byte(s)
  // then float32 samples (oldest first), 0xFF power, UTC
  if (fPort === 0x03) {
    if (b.length < 4) { return decodeError("short payload"); }
    var n = b[0], source = b[1], marker = b[2];
    var need = (marker === 0) ? (10 + 8 * n) : (9 + 4 * n);
    if (n < 1 || n > 12 || marker > 2 || b.length < need) {
      return decodeError("bad sampling frame: " + b.length + " bytes, expected " + need);
    }
    var srcName = (source === 1) ? "analog" : "rs485";
    var si = { sample_count: n };
    var p;

    if (marker === 0) {                        // BOTH: two streams
      var tA = b[3], tB = b[4]; p = 5;
      var s1 = [], s2 = [];
      for (var s = 0; s < n; s++) { s1.push(fmtSample(source, tA, f32(u32(b, p)))); p += 4; }
      for (var s = 0; s < n; s++) { s2.push(fmtSample(source, tB, f32(u32(b, p)))); p += 4; }
      if (source === 1) {
        si.channels = [
          { channel: "A", sensor_type: ANALOG_MODE[tA] || "unknown", samples: s1 },
          { channel: "B", sensor_type: ANALOG_MODE[tB] || "unknown", samples: s2 }
        ];
      } else {
        si.fields = [
          { field: 1, data_type: TYPE_NAME[tA] || "unknown", samples: s1 },
          { field: 2, data_type: TYPE_NAME[tB] || "unknown", samples: s2 }
        ];
      }
    } else {                                   // SINGLE: one stream
      var idx = marker, dtype = b[3]; p = 4;
      var samples = [];
      for (var s = 0; s < n; s++) { samples.push(fmtSample(source, dtype, f32(u32(b, p)))); p += 4; }
      if (source === 1) { si.channel = chAB(idx); si.sensor_type = ANALOG_MODE[dtype] || "unknown"; }
      else              { si.field = idx;        si.data_type   = TYPE_NAME[dtype]   || "unknown"; }
      si.samples = samples;
    }
    data.type = "sampling";
    data.deviceInfo = buildDeviceInfo(fPort, srcName, b[p], u32(b, p + 1));
    data.sensorInfo = si;
    return { data: data };
  }

  // ---------- Port 0x04 : trigger alarm / clear ----------
  // 21-byte frame (this node): [0]trig [1]param [2]event [3-6]value [7-10]min
  //                [11-14]max [15]0xFF power [16-19]UTC [20]source (0=RS485, 1=analog).
  //   value/min/max are int32 x100.
  // 15-byte frame (battery node): [3-4]value [5-6]min [7-8]max [9]power
  //                [10-13]UTC [14]source. int16 x100: limited to -327.68..327.67.
  if (fPort === 0x04) {
    if (b.length < 15) { return decodeError("short payload"); }
    var wide = (b.length >= 21);                     // 4-byte numbers
    var tw = wide ? 4 : 2;
    var rd = wide ? i32 : i16;
    var tail = 3 + 3 * tw;                           // power byte position
    var pNum = (b[1] === 1) ? 2 : 1;                 // field / channel number
    var analog = (b[tail + 5] === 1);
    data.type = "trigger";
    data.deviceInfo = buildDeviceInfo(fPort, analog ? "analog" : "rs485", b[tail], u32(b, tail + 1));
    data.deviceInfo.trigNum = b[0];
    data.deviceInfo.event   = (b[2] === 1) ? "ALARM" : "CLEAR";
    data.sensorInfo = {
      param: analog ? ("Channel " + chAB(pNum)) : ("Field " + pNum),
      value: rd(b, 3) / 100,                       // numbers, not strings
      min:   rd(b, 3 + tw) / 100,
      max:   rd(b, 3 + 2 * tw) / 100
    };
    return { data: data };
  }

  // ---------- Port 0x05 : boot info (no power byte) ----------
  // Sent right after join, before the network time arrives, so the time is
  // normally "not synced" here.
  if (fPort === 0x05) {
    if (b.length < 10) { return decodeError("short payload"); }
    data.type = "boot";
    data.deviceInfo = buildDeviceInfo(fPort, null, null, u32(b, 6));
    data.deviceInfo["Firmware Version"] = b[0] + "." + b[1] + "." + b[2];
    data.deviceInfo["Hardware Version"] = b[3] + "." + b[4] + "." + b[5];
    return { data: data };
  }

  // ---------- Ports 0x10-0x15 : config echo (values read back from the node) ----------
  if (fPort >= 0x10 && fPort <= 0x15) {
    var ACK_LEN = { 16: 5, 17: 2, 18: 2, 19: 4, 20: 11, 21: 7 };
    if (b.length < ACK_LEN[fPort]) { return decodeError("short payload"); }
    var ack = { appliedPort: fPort };
    if (fPort === 0x10) {
      ack.feature = "tx_interval"; ack.interval = u32(b, 0); setPower(ack, b[4]);
    } else if (fPort === 0x11) {
      ack.feature = "adr"; ack.adr = (b[0] === 1) ? "ON" : "OFF"; setPower(ack, b[1]);
    } else if (fPort === 0x12) {
      ack.feature = "msg_type"; ack.msgtype = (b[0] === 1) ? "CONFIRMED" : "UNCONFIRMED"; setPower(ack, b[1]);
    } else if (fPort === 0x13) {
      ack.feature = "msg_info"; ack.adr = (b[0] === 1) ? "ON" : "OFF";
      ack.sf = b[1];                 // SF for IN865/EU868/AS923/AU915 (= 12 - DR)
      ack.dr = 12 - b[1];
      ack.msgtype = (b[2] === 1) ? "CONFIRMED" : "UNCONFIRMED"; setPower(ack, b[3]);
    } else if (fPort === 0x14) {
      // 15 bytes (this node): trig,param,min32,max32,ct16,en,source,power
      // 11 bytes (battery node): trig,param,min16,max16,ct16,en,source,power
      var w20 = (b.length >= 15) ? 4 : 2;
      var rd20 = (w20 === 4) ? i32 : i16;
      var q20 = 2 + 2 * w20;                          // checktime position
      var tAnalog = (b[q20 + 3] === 1);
      var tp = (b[1] === 1) ? 2 : 1;                  // field / channel number
      ack.feature = "trigger"; ack.trig = b[0];
      ack.param = tAnalog ? ("Channel " + chAB(tp)) : ("Field " + tp);
      ack.source = tAnalog ? "analog" : "rs485";
      ack.min = rd20(b, 2) / 100; ack.max = rd20(b, 2 + w20) / 100;   // numbers
      ack.checktime = u16(b, q20); ack.enable = (b[q20 + 2] === 1) ? "ENABLED" : "DISABLED";
      setPower(ack, b[q20 + 4]);
    } else {                                   // 0x15 sampling
      var sAnalog = (b[3] === 1);
      ack.feature = "sampling";
      if (b[0] === 2) { ack.param = "both"; }
      else {
        var sn = (b[0] === 1) ? 2 : 1;
        ack.param = sAnalog ? ("Channel " + chAB(sn)) : ("Field " + sn);
      }
      ack.source = sAnalog ? "analog" : "rs485";
      ack.count = b[1];
      ack.enable = (b[2] === 1) ? "ENABLED" : "DISABLED";
      ack.interval = u16(b, 4);                // seconds between samples
      setPower(ack, b[6]);
    }
    data.type = "config_ack";
    data.configAck = ack;
    return { data: data };
  }

  // ---------- Ports 8,9,10,12,13,15 : RS485/Modbus downlink replies ----------
  // Reply layout: [0]=2 [1]=0x02 [2]=port [3]=state <feature...> UTC(4).
  // state: 0 ok, 1 failed, 2 invalid. No power byte.
  if (fPort === 8 || fPort === 9 || fPort === 10 ||
      fPort === 12 || fPort === 13 || fPort === 15) {
    var MB_LEN = { 8: 14, 9: 14, 10: 16, 12: 11, 13: 9, 15: 16 };
    if (b.length < MB_LEN[fPort] || b[0] !== 2 || b[1] !== 0x02 || b[2] !== fPort) {
      return decodeError("malformed modbus reply");
    }
    data.type = "modbus_ack";
    data.deviceInfo = modbusDeviceInfo(fPort, b);
    var st = b[3];
    var m = { state: st, state_text: stateText(st) };

    if (fPort === 10 || fPort === 15) {          // field config: write / read-back
      m.feature = (fPort === 10) ? "field_config_set" : "field_config_read";
      if (fPort === 15 && st === 2) {
        m.error = "index out of range (1..20)";
      } else {
        if (fPort === 10 && st !== 0) { m.error = "not stored: index out of range (1..20) or EEPROM verify failed"; }
        m.index     = b[4];
        m.slaveId   = b[5];
        m.fc        = b[6];
        m.enable    = b[7];
        m.data_type = TYPE_NAME[b[8]] || ("type" + b[8]);
        m.numParams = b[9];
        m.address   = u16(b, 10);
      }
    } else if (fPort === 8 || fPort === 9) {     // coil write / register write
      m.feature = (fPort === 8) ? "coil_write" : "register_write";
      m.slaveId = b[4];
      m.numReg  = b[5];
      m.address = u16(b, 6);
      if (b[5] === 1) {
        m.fc = (fPort === 8) ? 5 : 6;
        if (fPort === 8) { m.value = u16(b, 8) ? "ON" : "OFF"; }
        else { m.value = u16(b, 8); m.value_signed = i16(b, 8); }
      } else {
        m.fc = (fPort === 8) ? 15 : 16;
        m.value_low16 = u16(b, 8);               // node echoes only the low 16 bits
      }
    } else if (fPort === 13) {                   // live register read
      m.feature = "register_read";
      var rtag = b[4];
      var rt = (rtag >> 5) & 0x07, rc = rtag & 0x1F;
      var dataEnd = b.length - 4;
      if (rc === 0) {                            // node always sends state 0; failure is in the tag
        m.read = (rt === 7) ? "error" : "no_data";
        m.state_text = "failed";
      } else {
        m.data_type = TYPE_NAME[rt] || ("type" + rt);
        if (rt > 1 && (dataEnd - 5) === rc * 2) {
          // coil/discrete read (fc 1/2): rc = coil BYTES, each sent as 0x00,byte
          var cb = [];
          for (var mm = 0; mm < rc; mm++) { cb.push(b[5 + 2 * mm + 1]); }
          m.coil_bytes = cb;                     // bit0 of coil_bytes[0] = first coil
        } else {
          var w = (rt <= 1) ? 2 : 4, vals2 = [], q = 5;
          for (var mm = 0; mm < rc && q + w <= dataEnd; mm++) { vals2.push(decodeValue(rt, b, q)); q += w; }
          m.values = vals2;
        }
      }
    } else if (fPort === 12) {                   // baud + parity
      m.feature = "baud";
      m.baud    = u16(b, 4);
      m.parity  = b[6];
      m.parity_text = (b[6] <= 2) ? ["none", "even", "odd"][b[6]] : "unchanged";
    }
    if (m.state_text === "failed" && (fPort === 8 || fPort === 9 || fPort === 13)) {
      m.hint = "no Modbus answer: wiring/slave/settings, or node is in ANALOG mode (DEV_TYPE=1)";
    }

    data.modbusAck = m;
    return { data: data };
  }

  // ---------- Unknown port ----------
  return { data: { fPort: fPort, warnings: ["Unknown fPort " + fPort] } };
}

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

// Milesight / ChirpStack v3 entry points
function Decode(fPort, bytes, variables) {
  return decodeUplink({ bytes: bytes, fPort: fPort, variables: variables }).data;
}
function Encode(fPort, obj, variables) {
  var o = {};
  for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { o[key] = obj[key]; } }
  if (o.port === undefined) { o.port = fPort; }
  else if (Number(o.port) !== fPort) { throw new Error("JSON port " + o.port + " does not match FPort " + fPort); }
  var r = encodeDownlink({ data: o, variables: variables });
  if (r.errors && r.errors.length) { throw new Error(r.errors.join("; ")); }
  return r.bytes;
}
