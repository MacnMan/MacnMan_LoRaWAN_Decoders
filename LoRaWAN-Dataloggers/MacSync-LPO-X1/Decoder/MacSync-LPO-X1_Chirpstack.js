// ===================================================================
// MacSync-LPO-X1 — RS485 (Modbus RTU) / Analog to LoRaWAN Datalogger
// Macnman Technologies Pvt. Ltd.
//
// UPLINK ports:
//   0x02 (2)  sensor data (RS485 sweep or analog channels)
//   0x03 (3)  multi-sample batch (float32 samples)
//   0x04 (4)  trigger ALARM / CLEAR
//   0x05 (5)  boot (firmware/hardware version + UTC)
//   0x10-0x15 (16-21) config ACK — echo of an applied config downlink
//   8 / 9 / 10 / 12 / 13 / 15  Modbus command replies (same port as downlink)
//
// DOWNLINK ports (see the matching Encoder file):
//   16 TXinterval, 17 ADR, 18 MsgType, 19 MSGINFO(adr+sf+msgtype),
//   20 TrigCfg, 21 SampCfg, 10 Modbus field config, 15 field read-back,
//   13 live register read, 9 register write, 8 coil write, 12 baud+parity
// ===================================================================

var IST_OFFSET = 19800;   // +5:30 in seconds

// ---- helpers ----------------------------------------------------
function u16(b, i) { return ((b[i] << 8) | b[i + 1]) >>> 0; }
function s16(b, i) {
  var v = (b[i] << 8) | b[i + 1];
  return (v & 0x8000) ? v - 0x10000 : v;
}
function u32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
function s32(b, i) {
  return (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
}
// IEEE-754 float32 from a big-endian uint32 (no DataView — keeps the codec
// portable across TTN / ChirpStack / Milesight JS engines)
function f32FromU32(u) {
  var sign = (u >>> 31) ? -1 : 1;
  var exp = (u >>> 23) & 0xFF;
  var man = u & 0x7FFFFF;
  if (exp === 0xFF) return man ? NaN : sign * Infinity;
  if (exp === 0) return sign * man * Math.pow(2, -149);
  return sign * (man + 0x800000) * Math.pow(2, exp - 150);
}
function round2(v) { return Math.round(v * 100) / 100; }
function pad(n) { return ("0" + n).slice(-2); }

function isoString(unixSec, offsetSec) {
  var d = new Date((unixSec + offsetSec) * 1000);
  var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
          pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" +
          pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  return offsetSec === 0 ? s + "Z" : s + "+05:30";
}

function buildDeviceInfo(fPort, battery, unixUTC) {
  return {
    fPort:   fPort,
    battery: battery,
    unixUTC: unixUTC,
    timeUTC: isoString(unixUTC, 0),
    timeIST: isoString(unixUTC, IST_OFFSET)
  };
}

// Modbus register data types (firmware AT+MODCONF dataType 0..7)
var MODBUS_TYPES = [
  "int16", "uint16",
  "int32", "int32_ws",      // _ws = word-swapped (LSB word first)
  "float32", "float32_ws",
  "uint32_ws", "uint32"
];

// Decode `count` register values of `dataType` starting at b[i].
// Returns { values: [...], next: index-after-block }.
function readRegisterValues(b, i, dataType, count) {
  var values = [];
  var wide = (dataType >= 2);              // 32-bit types use 4 bytes
  for (var k = 0; k < count; k++) {
    var v;
    if (!wide) {
      v = (dataType === 0) ? s16(b, i) : u16(b, i);
      i += 2;
    } else {
      var raw;
      if (dataType === 3 || dataType === 5 || dataType === 6) {
        // word-swapped: LSB word transmitted first
        raw = ((b[i + 2] << 24) | (b[i + 3] << 16) | (b[i] << 8) | b[i + 1]) >>> 0;
      } else {
        raw = u32(b, i);
      }
      if (dataType === 2 || dataType === 3) {
        v = raw | 0;                       // signed int32
      } else if (dataType === 4 || dataType === 5) {
        v = round2(f32FromU32(raw));       // float32
      } else {
        v = raw;                           // uint32
      }
      i += 4;
    }
    values.push(v);
  }
  return { values: values, next: i };
}

// ===================================================================
// UPLINK DECODER
// ===================================================================
function decodeUplink(input) {
  var b = input.bytes;
  var fPort = input.fPort;
  var data = {};

  // ============ PORT 0x05 : BOOT (device info, 10 bytes) ============
  if (fPort === 0x05) {
    data.type = "boot";
    data.deviceInfo = buildDeviceInfo(fPort, null, u32(b, 6));
    delete data.deviceInfo.battery;                 // boot has no battery byte
    data.deviceInfo["Firmware Version"] = b[0] + "." + b[1] + "." + b[2];
    data.deviceInfo["Hardware Version"] = b[3] + "." + b[4] + "." + b[5];
    return { data: data };
  }

  // ============ PORT 0x02 : SENSOR DATA (heartbeat / ping) ============
  if (fPort === 0x02) {
    data.type = "heartbeat";
    var source = b[1];                               // [1] 0=RS485, 1=analog
    data.source = (source === 1) ? "analog" : "rs485";

    var battery = b[b.length - 5];
    var unixUTC = u32(b, b.length - 4);
    data.deviceInfo = buildDeviceInfo(fPort, battery, unixUTC);

    if (source === 1) {
      // ---- analog: [mode u8, value s16 x1000] per channel, 0x00 = off ----
      var chIdx = 2;
      var channels = {};
      for (var ch = 1; ch <= 2; ch++) {
        if (b[chIdx] === 0x00) {
          channels["channel" + ch] = { mode: "off" };
          chIdx += 1;
        } else {
          var mode = b[chIdx];
          var val = s16(b, chIdx + 1) / 1000;
          channels["channel" + ch] =
            (mode === 1) ? { mode: "4-20mA",  value_mA:    round2(val) } :
            (mode === 2) ? { mode: "0-10V",   value_V:     round2(val) } :
                           { mode: "digital", value:       (val >= 1) ? 1 : 0 };
          chIdx += 3;
        }
      }
      data.sensorInfo = channels;
    } else {
      // ---- RS485: tag byte per configured field, then register bytes ----
      // tag = (dataType << 5) | count;  count==0 -> status marker
      var fields = [];
      var i = 2;
      var fieldNum = 0;
      var end = b.length - 5;                        // battery + UTC trailer
      while (i < end) {
        fieldNum += 1;
        var tag = b[i]; i += 1;
        var dataType = (tag >> 5) & 0x07;
        var count = tag & 0x1F;
        if (count === 0) {
          fields.push({
            field: fieldNum,
            status: (dataType === 0x07) ? "read_error" : "disabled"
          });
          continue;
        }
        var block = readRegisterValues(b, i, dataType, count);
        i = block.next;
        fields.push({
          field: fieldNum,
          dataType: MODBUS_TYPES[dataType],
          values: block.values
        });
      }
      data.sensorInfo = { fields: fields };
    }
    return { data: data };
  }

  // ============ PORT 0x03 : MULTI-SAMPLE BATCH (float32) ============
  if (fPort === 0x03) {
    data.type = "sampling";

    var count3 = b[0];
    var src3 = b[1];                                 // 0=RS485 field, 1=analog
    var sel = b[2];                                  // 0=both, 1, 2
    var idx3, types = [];
    if (sel === 0) {
      types = [b[3], b[4]];
      idx3 = 5;
    } else {
      types = [b[3]];
      idx3 = 4;
    }

    function typeName(t) {
      if (src3 === 1) {
        return (t === 1) ? "4-20mA" : (t === 2) ? "0-10V" : (t === 3) ? "digital" : "type" + t;
      }
      return MODBUS_TYPES[t] || ("type" + t);
    }

    var streams = [];
    var streamCount = (sel === 0) ? 2 : 1;
    for (var s = 0; s < streamCount; s++) {
      var samples = [];
      for (var n = 0; n < count3; n++) {
        samples.push(round2(f32FromU32(u32(b, idx3))));
        idx3 += 4;
      }
      streams.push({
        channel: (sel === 0) ? (s + 1) : sel,
        dataType: typeName(types[s]),
        samples: samples
      });
    }

    var battery3 = b[idx3]; idx3 += 1;
    var unix3 = u32(b, idx3);

    data.deviceInfo = buildDeviceInfo(fPort, battery3, unix3);
    data.sensorInfo = {
      source: (src3 === 1) ? "analog" : "rs485",
      count: count3,
      streams: streams
    };
    return { data: data };
  }

  // ============ PORT 0x04 : TRIGGER ALARM / CLEAR (15 bytes) ============
  // [0]trig [1]param [2]event [3-4]value [5-6]min [7-8]max
  // [9]battery [10-13]UTC [14]source
  if (fPort === 0x04) {
    data.type = "trigger";
    data.deviceInfo = buildDeviceInfo(fPort, b[9], u32(b, 10));
    data.deviceInfo.trigNum = b[0];
    data.deviceInfo.event = (b[2] === 1) ? "ALARM" : "CLEAR";
    var trigSrc = (b[14] === 1) ? "analog" : "rs485";
    data.sensorInfo = {
      source: trigSrc,
      param: ((trigSrc === "analog") ? "channel" : "field") + (b[1] + 1),
      value: s16(b, 3) / 100,
      min:   s16(b, 5) / 100,
      max:   s16(b, 7) / 100
    };
    return { data: data };
  }

  // ====== PORTS 0x10..0x15 : CONFIG ACK (echo of applied downlink) ======
  if (fPort >= 0x10 && fPort <= 0x15) {
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
      ack.sf      = b[1];
      ack.msgtype = (b[2] === 1) ? "CONFIRMED" : "UNCONFIRMED";
      ack.battery = b[3];

    } else if (fPort === 0x14) {  // trig,param,min,max,ct,en,source + batt
      ack.feature   = "trigger";
      ack.trig      = b[0];
      ack.param     = "field_or_channel_" + (b[1] + 1);
      ack.min       = s16(b, 2) / 100;
      ack.max       = s16(b, 4) / 100;
      ack.checktime = u16(b, 6);
      ack.enable    = (b[8] === 1) ? "ENABLED" : "DISABLED";
      ack.source    = (b[9] === 1) ? "analog" : "rs485";
      ack.battery   = b[10];

    } else {                     // 0x15: param,count,en,source,interval + batt
      ack.feature  = "sampling";
      ack.param    = (b[0] === 2) ? "both" : "field_or_channel_" + (b[0] + 1);
      ack.count    = b[1];
      ack.enable   = (b[2] === 1) ? "ENABLED" : "DISABLED";
      ack.source   = (b[3] === 1) ? "analog" : "rs485";
      ack.interval = u16(b, 4);
      ack.battery  = b[6];
    }

    data.type = "config_ack";
    data.configAck = ack;
    return { data: data };
  }

  // ====== MODBUS REPLY PORTS 8 / 9 / 10 / 12 / 13 / 15 ======
  // Frame: [0]=2 [1]=0x02 [2]=port [3]=state ... then UTC (last 4 bytes)
  if (fPort === 8 || fPort === 9 || fPort === 10 ||
      fPort === 12 || fPort === 13 || fPort === 15) {

    var reply = {
      port:  b[2],
      state: (b[3] === 0) ? "OK" : (b[3] === 2) ? "BAD_INDEX" : "ERROR"
    };
    var unixR = u32(b, b.length - 4);

    if (fPort === 10 || fPort === 15) {      // field config write / read-back
      reply.feature   = (fPort === 10) ? "modbus_field_config" : "modbus_field_read";
      reply.index     = b[4];
      reply.slaveId   = b[5];
      reply.functionCode = b[6];
      reply.enable    = b[7];
      reply.dataType  = MODBUS_TYPES[b[8]] || b[8];
      reply.numberOfParameters = b[9];
      reply.registerAddress = u16(b, 10);

    } else if (fPort === 8 || fPort === 9) { // coil / register write echo
      reply.feature = (fPort === 8) ? "modbus_coil_write" : "modbus_register_write";
      reply.slaveId = b[4];
      reply.numberOfRegisters = b[5];
      reply.registerAddress = u16(b, 6);
      reply.value = s16(b, 8);

    } else if (fPort === 12) {               // baud + parity echo
      reply.feature = "modbus_baud";
      reply.baud    = u16(b, 4);
      reply.parity  = b[6];

    } else {                                 // 13: live register read
      reply.feature = "modbus_register_read";
      var tag13 = b[4];
      var dt13 = (tag13 >> 5) & 0x07;
      var cnt13 = tag13 & 0x1F;
      if (cnt13 === 0) {
        reply.readState = "read_error";
      } else {
        reply.dataType = MODBUS_TYPES[dt13];
        reply.values = readRegisterValues(b, 5, dt13, cnt13).values;
      }
    }

    data.type = "modbus_reply";
    data.deviceInfo = buildDeviceInfo(fPort, null, unixR);
    delete data.deviceInfo.battery;
    data.modbusReply = reply;
    return { data: data };
  }

  // ============ Unknown port ============
  return {
    data: { fPort: fPort },
    warnings: ["Unknown fPort " + fPort]
  };
}
