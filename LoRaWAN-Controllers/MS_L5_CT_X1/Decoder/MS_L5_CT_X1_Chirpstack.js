/**
 * Macnman LoRaWAN payload codec V5.1 - controllers and nodes
 * Macnman Technologies Pvt. Ltd.
 *
 * ChirpStack v4 file of the MacSet MS-L5-CT-X1 relay controller (was
 * MS-LPC-ST-X1). The same codec for The Things Stack is
 * MS_L5_CT_X1_TTN.js, for the Milesight gateway MS_L5_CT_X1_Milesight.js.
 *
 * V5.0  29-Sep-2025  Prabhudayal Patel
 * V5.1  13-Oct-2026  Controller frames checked against the MacSet
 *                    MS-L5-CT-X1 (was MS-LPC-ST-X1) firmware. Change list
 *                    at the end of the file.
 *
 * Entry points
 *   decodeUplink(input)    TTN v3 / ChirpStack v4 style network servers
 *   Decode(fPort, bytes)   ChirpStack v3 style; for the Milesight gateway
 *                          use MS_L5_CT_X1_Milesight.js
 *   encodeDownlink(input)  TTN v3 / ChirpStack v4 style network servers.
 *                          Put the port in the JSON as "fPort" and use the
 *                          same FPort for the downlink itself.
 *
 * Uplink frame
 *   [0] frame type   0 boot, 1 periodic data, 2 response, 3 alarm, 4 samples
 *   [1] device type  see DEVICE_TYPES; response frames always carry 2
 *   ...              frame specific, see each decoder below
 *   last 4 bytes     time stamp, seconds (big endian)
 * Controllers send these frames on FPort 2. Their boot and periodic frames
 * carry local time (UTC + 5:30), their response frames carry UTC.
 * Controller response frames (firmware from 27 Oct 2026): on the FPort of
 * the downlink they answer (5, 6, 8 - 15), unconfirmed, as the SHT40 node's
 * echo; same layout, decoded the same on any FPort. Older firmware: FPort 2.
 * Controller relay event (firmware from 15 Oct 2026): FPort 4, its own
 * layout, see decodeRelayEvent(); time stamp UTC.
 * Controller sampling (firmware from 22 Oct 2026): readings on FPort 3 and
 * the settings echo on FPort 21, in the layout of the MacSync MY-L1-CV-X1
 * (was MS-LBS-STD-X1) node, see decodeSamplingBatch(); time stamp UTC.
 * Controller ADR / message type (firmware from 23 Oct 2026): the answer to
 * a port 17 / 18 downlink comes on that same FPort, as on the MacSync
 * MY-L1-TH-X1 (SHT40, was MS-LBS-TH-X1) node, see decodeSettingEcho(); the
 * same for port 19 (ADR + SF + message type, firmware from 27 Oct 2026).
 *
 * The output keys are the same as in V5.0, spelling included
 * (protocall, responce, SUCCSESS), so existing dashboards keep working.
 */

// =====================================================================
// CONSTANTS
// =====================================================================

var DEVICE_TYPES = {
    0: "RS485_Node",
    1: "Analog_Node",
    2: "RS485_Controller",
    3: "Analog_Controller",
    16: "MacSense_V2.0"
};

// MacSense parameter names, indexed by sensor code.
var SENSOR_FIELD_NAMES = ["level", "temperature", "humidity", "pressure",
    "windspeed", "winddirection", "rainfall", "snowfall", "co2", "pm2.5",
    "levelmm", "levelcm", "levelm3"];

// =====================================================================
// ENTRY POINTS
// =====================================================================

function decodeUplink(input) {
    return {
        data: {
            Payload: Decoder(input.bytes, input.fPort)
        },
        warnings: [],
        errors: []
    };
}

function Decode(fPort, bytes) {
    return {
        Payload: Decoder(bytes, fPort)
    };
}

// =====================================================================
// BYTE HELPERS (all multi-byte values are big endian)
// =====================================================================

// One byte as two hex digits, for example 0x0A -> "0a".
function str_pad(byte) {
    var hex = byte.toString(16);
    return (hex.length < 2 ? "0" : "") + hex;
}

function readUint16(bytes, i) {
    return ((bytes[i] << 8) | bytes[i + 1]) >>> 0;
}

function readInt16(bytes, i) {
    var value = readUint16(bytes, i);
    return (value & 0x8000) ? value - 0x10000 : value;
}

function readUint32(bytes, i) {
    return ((bytes[i] << 24) | (bytes[i + 1] << 16) |
        (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
}

// Time stamp in the last 4 bytes of a frame.
function readTimestamp(bytes) {
    return readUint32(bytes, bytes.length - 4);
}

function isController(deviceType) {
    return deviceType === 2 || deviceType === 3;
}

// 32-bit float from 4 bytes. isMsb 1: ABCD order, 0: CDAB (word swapped).
function GetFloat(dataBytes, isMsb) {
    var view = new DataView(new ArrayBuffer(4));
    if (isMsb) {
        view.setUint8(0, dataBytes[0]);
        view.setUint8(1, dataBytes[1]);
        view.setUint8(2, dataBytes[2]);
        view.setUint8(3, dataBytes[3]);
    } else {
        view.setUint8(2, dataBytes[0]);
        view.setUint8(3, dataBytes[1]);
        view.setUint8(0, dataBytes[2]);
        view.setUint8(1, dataBytes[3]);
    }
    return view.getFloat32(0, false);
}

// Signed 32-bit integer from 4 bytes. isMsb 1: ABCD order, 0: CDAB.
function GetLongInt(dataBytes, isMsb) {
    var view = new DataView(new ArrayBuffer(4));
    if (isMsb) {
        view.setUint8(0, dataBytes[0]);
        view.setUint8(1, dataBytes[1]);
        view.setUint8(2, dataBytes[2]);
        view.setUint8(3, dataBytes[3]);
    } else {
        view.setUint8(2, dataBytes[0]);
        view.setUint8(3, dataBytes[1]);
        view.setUint8(0, dataBytes[2]);
        view.setUint8(1, dataBytes[3]);
    }
    return view.getInt32(0, false);
}

// 32-bit float from 4 bytes in plain byte order (MacSense frames).
function GetFloatFromBytes(byteArray, isLittleEndian) {
    if (isLittleEndian === undefined) {
        isLittleEndian = 1;
    }
    return new DataView(Uint8Array.from(byteArray).buffer)
        .getFloat32(0, isLittleEndian === 1);
}

// Local test helper: "0102ff" -> [1, 2, 255].
function hexToBytes(hex) {
    var bytes = [];
    for (var c = 0; c < hex.length; c += 2) {
        bytes.push(parseInt(hex.substr(c, 2), 16));
    }
    return bytes;
}

// =====================================================================
// MAIN DECODER
// =====================================================================

function Decoder(bytes, port) {
    var decode = {};
    if (!bytes || bytes.length < 2) {
        return decode;
    }
    if (Number(port) === 4) { // controller relay event, own layout
        decode.relayEvent = decodeRelayEvent(bytes);
        return decode;
    }
    if (Number(port) === 3 && isSamplingBatch(bytes)) { // controller sampling
        decode.sampling = decodeSamplingBatch(bytes);
        return decode;
    }
    if (Number(port) === 21 && bytes.length === 7) { // its settings echo
        decode.samplingConfig = decodeSamplingEcho(bytes);
        return decode;
    }
    if ((Number(port) === 17 || Number(port) === 18) && bytes.length === 2) {
        decode.lorawanConfig = decodeSettingEcho(bytes, Number(port));
        return decode;
    }
    if (Number(port) === 19 && bytes.length === 4) {
        decode.lorawanConfig = decodeMsgInfoEcho(bytes);
        return decode;
    }
    var parser = getParser(bytes[1]);
    if (!parser) {
        return decode;
    }
    switch (bytes[0]) {
        case 0:
            decode.boot = parser(bytes);
            break;
        case 1:
            decode.deviceinfo = getDeviceinfo(bytes, port);
            decode.devicedata = parser(bytes);
            break;
        case 2:
            decode.responce = parser(bytes);
            break;
        case 3:
            decode.alarm = parser(bytes);
            break;
        case 4:
            decode.samples = parser(bytes);
            break;
        default:
            break;
    }
    return decode;
}

// =====================================================================
// SAMPLING (FPort 3) and its settings echo (FPort 21): controller firmware
// from 22 Oct 2026, in the layout of the MacSync MY-L1-CV-X1 node
//   [0] readings n   [1] source 0 RS485, 1 analog
//   [2] input 1 or 2, or 0 for both   [3] its type ([4] type of input 2)
//   n floats of the input (both: n of input 1, then n of input 2),
//   4 bytes each, big endian; then 0xFF (the node's battery byte) and the
//   UTC time stamp. Size 9 + 4 n, or 10 + 8 n for both.
// type: the RS485 field's data type, or the analog channel's mode.
// "Both" (input 0 in [2]) is sent only by controller firmware of 22 - 27 Oct
// 2026 and by the MY-L1-CV-X1 node; it is still decoded. Controller
// firmware from 27 Oct 2026 (later build) samples one input only.
// =====================================================================

var SAMPLING_DATA_TYPES = ["int16", "uint16", "int32", "int32 CDAB",
    "float", "float CDAB"];
var SAMPLING_ANALOG_MODES = ["off", "current mA", "voltage V",
    "voltage V, clipped at 0"];

// true only for a frame of exactly this layout: other devices may send on
// FPort 3 as well.
function isSamplingBatch(bytes) {
    var n = bytes[0];
    if (n < 2 || n > 12 || bytes[1] > 1 || bytes[2] > 2) {
        return false;
    }
    return bytes.length === (bytes[2] === 0 ? 10 + 8 * n : 9 + 4 * n);
}

// One input's readings, starting at byte at.
function samplingInput(bytes, source, input, type, at, n) {
    var out = {};
    var samples = [];
    for (var k = 0; k < n; k++) {
        var p = at + 4 * k;
        samples.push(parseFloat(GetFloat(bytes.slice(p, p + 4), 1).toFixed(3)));
    }
    if (source === 1) {
        out.channel = (input === 1) ? "A" : "B";
        out.mode = SAMPLING_ANALOG_MODES[type] || "unknown";
    } else {
        out.field = input;
        out.dataType = SAMPLING_DATA_TYPES[type] || "unknown";
    }
    out.samples = samples;
    return out;
}

function decodeSamplingBatch(bytes) {
    var n = bytes[0];
    var source = bytes[1];
    var out = {
        messageType: "Sampling",
        source: (source === 1) ? "analog" : "rs485",
        sampleCount: n
    };
    if (bytes[2] === 0) {
        out.inputs = [
            samplingInput(bytes, source, 1, bytes[3], 5, n),
            samplingInput(bytes, source, 2, bytes[4], 5 + 4 * n, n)
        ];
    } else {
        out.inputs = [samplingInput(bytes, source, bytes[2], bytes[3], 4, n)];
    }
    out.Systimestamp = readTimestamp(bytes);
    return out;
}

// Settings echo, the answer to a port 21 downlink:
//   [0] input 0 field / channel 1, 1 field / channel 2, 2 both
//   [1] readings per uplink   [2] enable   [3] source 0 RS485, 1 analog
//   [4,5] seconds between readings   [6] 0xFF
function decodeSamplingEcho(bytes) {
    var analog = bytes[3] === 1;
    var input = "both";
    if (bytes[0] !== 2) {
        input = analog ? ("channel " + (bytes[0] === 1 ? "B" : "A")) :
            ("field " + (bytes[0] + 1));
    }
    return {
        messageType: "Sampling settings",
        source: analog ? "analog" : "rs485",
        input: input,
        sampleCount: bytes[1],
        enable: bytes[2],
        interval: readUint16(bytes, 4)
    };
}

// =====================================================================
// ADR (FPort 17) and MESSAGE TYPE (FPort 18) ECHO: the answer to that
// downlink, controller firmware from 23 Oct 2026, as on the SHT40 node
//   [0] the value now stored   [1] 0xFF (the SHT40 node's battery byte)
// The values read as in the SHT40 codec: ON / OFF, CONFIRMED / UNCONFIRMED.
// =====================================================================

function decodeSettingEcho(bytes, port) {
    if (port === 17) {
        return {
            messageType: "ADR setting",
            adr: bytes[0] === 1 ? "ON" : "OFF"
        };
    }
    return {
        messageType: "Message type setting",
        msgtype: bytes[0] === 1 ? "CONFIRMED" : "UNCONFIRMED"
    };
}

// MSGINFO echo (FPort 19), the answer to a port 19 downlink, controller
// firmware from 27 Oct 2026, as on the SHT40 node:
//   [0] ADR 1 / 0   [1] SF 7 .. 12   [2] type 1 confirmed / 0 unconfirmed
//   [3] 0xFF (the SHT40 node's battery byte)
function decodeMsgInfoEcho(bytes) {
    return {
        messageType: "LoRaWAN settings",
        adr: bytes[0] === 1 ? "ON" : "OFF",
        sf: bytes[1],
        msgtype: bytes[2] === 1 ? "CONFIRMED" : "UNCONFIRMED"
    };
}

// =====================================================================
// RELAY EVENT (FPort 4): sent by a controller when its relay schedule
// switches a relay ON or OFF
//   (layout of firmware before 21 Oct 2026; since then [2] holds both relay
//   states as bits and everything after it is one byte earlier, see
//   decodeRelayEvent)
//   [0] 0x01 relay change   [1] application type 0 single, 1 three phase
//   [2] relay 1 0/1 (three phase: 1 after START, 0 after STOP)
//   [3] relay 2 0/1 (0xFF in three phase)
//   [4] changed: bit 0 relay 1, bit 1 relay 2   [5] cause: 1 schedule
//   [6] slot 0-9 holding relay 1 ON (0xFF none)  [7] its type
//   [8] slot holding relay 2 ON                  [9] its type
//       type: 1 regular, 2 cyclic, 3 trigger
//   [10..13] time stamp, UTC
// Firmware from 19 Oct 2026 adds one 11-byte reason block per relay
// (relay 1 at [14], relay 2 at [25], 36 bytes in all):
//   [0] reason, see RELAY_REASONS (0 = relay not changed)
//   [1] trigger field (RS485 1-20, analog channel 1-2)
//   [2] trigger condition, see TRIGGER_CONDITIONS (0xFF = no trigger)
//   [3..6] trigger value x 100, [7..10] threshold x 100 (Min for between)
//          (signed 32 bit, big endian, -2147483648 = none)
//   For a relay that has just gone OFF, [6..9] name the schedule that
//   held it ON (older firmware sends 0xFF, "none").
// Firmware from 21 Oct 2026 adds the Max x 100 of a between trigger,
// [36..39] relay 1 and [40..43] relay 2 (44 bytes in all; -2147483648 =
// none, also for a between trigger saved before then, which uses the fixed
// limits 10 and 40).
// =====================================================================

var SCHEDULE_TYPES = ["none", "regular", "cyclic", "trigger"];

function scheduleRef(slot, type) {
    if (slot === 0xFF) {
        return "none";
    }
    return { slot: slot, type: SCHEDULE_TYPES[type] || "unknown" };
}

var RELAY_REASONS = ["not changed", "schedule ON time", "schedule OFF time",
    "trigger condition met", "trigger condition no longer met",
    "trigger sensor not answering", "trigger time window ended"];
var TRIGGER_CONDITIONS = ["greater than", "less than", "between 10 and 40"];
var NO_VALUE = -2147483648;

function readInt32(bytes, i) {
    return (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) |
        bytes[i + 3];
}

// Adds relay<n>Reason and, for a trigger schedule, relay<n>Trigger from the
// reason block at bytes[i]. maxAt: where this relay's between Max is
// (44-byte events), or -1.
function addRelayReason(ev, n, bytes, i, maxAt) {
    var reason = bytes[i];
    if (reason === 0) {
        return;
    }
    ev["relay" + n + "Reason"] = RELAY_REASONS[reason] || "unknown";
    if (bytes[i + 2] !== 0xFF) {
        var value = readInt32(bytes, i + 3);
        var threshold = readInt32(bytes, i + 7);
        var max = maxAt >= 0 ? readInt32(bytes, maxAt) : NO_VALUE;
        var trigger = {
            field: bytes[i + 1],
            condition: TRIGGER_CONDITIONS[bytes[i + 2]] || "unknown",
            value: value === NO_VALUE ? "none" : value / 100
        };
        if (bytes[i + 2] === 2 && max !== NO_VALUE) {
            // between the user's Min and Max (firmware from 21 Oct 2026)
            trigger.condition = "between";
            trigger.min = threshold / 100;
            trigger.max = max / 100;
        } else if (threshold !== NO_VALUE) {
            trigger.threshold = threshold / 100;
        }
        ev["relay" + n + "Trigger"] = trigger;
    }
}

// Firmware from 21 Oct 2026 sends both relay states in one byte, [2] bit 0
// relay 1, bit 1 relay 2, so every byte after it comes one place earlier
// (13, 35 or 43 bytes in all; older firmware 14, 36 or 44).
function decodeRelayEvent(bytes) {
    var ev = {};
    ev.messageType = "Relay Event";
    var n = bytes.length;
    var packed = (n === 13 || n === 35 || n === 43);
    if (bytes[0] !== 1 || n < 13 || (!packed && n < 14)) {
        ev.event = "unknown";
        return ev;
    }
    var o = packed ? -1 : 0; // place of the bytes after the relay states
    var r1 = packed ? (bytes[2] & 0x01) : bytes[2];
    var r2 = packed ? ((bytes[2] >> 1) & 0x01) : bytes[3];
    var three = bytes[1] === 1;
    ev.event = "relay_change";
    ev.cause = bytes[5 + o] === 1 ? "schedule" : "unknown";
    ev.applicationType = three ? "Three Phase" : "Single Phase";
    ev.relay1 = r1;
    ev.relay1Changed = (bytes[4 + o] & 0x01) !== 0;
    ev.relay1Schedule = scheduleRef(bytes[6 + o], bytes[7 + o]);
    var reasons = n >= 36 + o;
    var maxes = n >= 44 + o;
    if (reasons) {
        addRelayReason(ev, 1, bytes, 14 + o, maxes ? 36 + o : -1);
    }
    if (three) {
        ev.motor = r1 === 1 ? "START" : "STOP";
    } else {
        ev.relay2 = r2;
        ev.relay2Changed = (bytes[4 + o] & 0x02) !== 0;
        ev.relay2Schedule = scheduleRef(bytes[8 + o], bytes[9 + o]);
        if (reasons) {
            addRelayReason(ev, 2, bytes, 25 + o, maxes ? 40 + o : -1);
        }
    }
    ev.Systimestamp = readUint32(bytes, 10 + o);
    return ev;
}

function getParser(deviceType) {
    switch (deviceType) {
        case 0:
        case 2:
            return getRS485Data;
        case 1:
        case 3:
            return getAnalogData;
        case 16:
            return getMacSenseData;
        default:
            return null;
    }
}

// Common block of a periodic frame. Nodes send a battery byte (x10) just
// before the time stamp. Controllers are mains powered and send no
// battery byte: the byte there is a relay state, so it is not reported.
function getDeviceinfo(bytes, port) {
    var devInfo = {};
    devInfo.manufacturer = "Macnman India";
    devInfo.protocall = "LoRaWAN";
    devInfo.uplinkPort = port;
    devInfo.deviceID = bytes[1];
    if (!isController(bytes[1])) {
        devInfo.battery = bytes[bytes.length - 5] / 10;
    }
    devInfo.Systimestamp = readTimestamp(bytes);
    return devInfo;
}

// =====================================================================
// BOOT FRAME (frame type 0), 18 bytes
//   [0] 0x00   [1] device type
//   [2..5]   chip identity (company ID 3 bytes + device ID)
//   [6..8]   controllers: hardware version   nodes: firmware version
//   [9..11]  controllers: firmware version   nodes: hardware version
//   [12,13]  uplink interval, seconds (65535: 65535 s or longer)
//   [14..17] time stamp
// =====================================================================

function decodeBootMessage(bytes) {
    var boot_data = {};
    boot_data.messageType = "Boot Message";
    boot_data.OEM_ID = str_pad(bytes[2]) + str_pad(bytes[3]) +
        str_pad(bytes[4]) + str_pad(bytes[5]);
    // versions as plain numbers, "1.0.0", as in the SHT40 codec
    var first = bytes[6] + "." + bytes[7] + "." + bytes[8];
    var second = bytes[9] + "." + bytes[10] + "." + bytes[11];
    if (isController(bytes[1])) {
        boot_data.FR = second;
        boot_data.HW = first;
    } else {
        boot_data.FR = first;
        boot_data.HW = second;
    }
    // uplink interval in seconds; the frame has 2 bytes, so an interval
    // above 65535 s (up to 86400, firmware from 14 Oct 2026) shows as 65535
    boot_data.TDCM = readUint16(bytes, 12);
    boot_data.Systimestamp = readUint32(bytes, 14);
    return boot_data;
}

// Controller block of a periodic frame, just before the time stamp.
// tail: where it starts (the byte after the last field), or undefined.
//   firmware from 21 Oct 2026 (6 bytes left): [application type 0 single /
//     1 three phase] [relays: bit 0 relay 1, bit 1 relay 2]
//   older firmware (7 bytes left): [application type] [relay 1]
//     [relay 2, or 0xFF in three phase]
function decodeControllerTail(bytes, tail) {
    var n = bytes.length;
    var controller = {};
    var appType, r1, r2;
    if (tail !== undefined && n - tail === 6) {
        appType = bytes[tail];
        r1 = bytes[tail + 1] & 0x01;
        r2 = bytes[tail + 1] & 0x02;
    } else {
        appType = bytes[n - 7];
        r1 = bytes[n - 6];
        r2 = bytes[n - 5];
    }
    controller.appType = appType ? "Three Phase" : "Single Phase";
    if (appType === 0) {
        controller.r1Status = r1 ? "on" : "off";
        controller.r2Status = r2 ? "on" : "off";
    } else {
        controller.status = r1 ? "on" : "off";
    }
    return controller;
}

// The byte after the 20 Modbus fields of an RS485 controller frame (each
// field: a header byte and its values, see decodeModbusFields), or
// undefined when the fields do not fit the frame.
function rs485FieldsEnd(bytes) {
    var i = 2;
    for (var f = 0; f < 20; f++) {
        if (i >= bytes.length) {
            return undefined;
        }
        var h = decodeByte(bytes[i]);
        var size = (h.dataType <= 1) ? 2 : ((h.dataType <= 5) ? 4 : 0);
        i += 1 + size * h.numRegisters;
    }
    return i;
}

// The byte after the 2 channels of an analog controller frame (mode 0: one
// byte, modes 1 to 3: mode + 2 bytes).
function analogChannelsEnd(bytes) {
    var i = 2;
    for (var c = 0; c < 2; c++) {
        i += (bytes[i] >= 1 && bytes[i] <= 3) ? 3 : 1;
    }
    return i;
}

// =====================================================================
// ANALOG NODE (1) AND ANALOG CONTROLLER (3)
// =====================================================================

function getAnalogData(bytes) {
    if (bytes[0] === 0) {
        return decodeBootMessage(bytes);
    } else if (bytes[0] === 1) {
        return decodeAnalogPayload(bytes);
    } else if (bytes[0] === 4) {
        return decodeAnalogAlarm(bytes);
    }
}

// Periodic frame. Per channel: [mode], then [value hi][value lo] unless
// the mode is 0.
//   mode 0 disabled
//   mode 1 current, sent in uA, reported in mA
//   mode 2 voltage, sent in mV, reported in V
//   mode 3 digital level, sent as a voltage in mV, HIGH above 1.8 V
//          (the same threshold as AT+ANGCHECK in the controller)
// Controller: the channels are followed by the controller block and the
// time stamp. Node: by a battery byte and the time stamp (V5.0 layout).
function decodeAnalogPayload(bytes) {
    var analog_data = {};
    analog_data.messageType = "Payload";
    analog_data.analogData = {};
    var tail = bytes[1] === 3 ? analogChannelsEnd(bytes) : undefined;
    var lastIndex = bytes[1] <= 1 ? (bytes.length - 5) :
        ((bytes.length - tail === 6) ? (tail - 1) : (bytes.length - 8));
    var channel = 0;
    for (var i = 2; i <= lastIndex; i++) {
        var name = "channel_" + String.fromCharCode(97 + channel);
        switch (bytes[i]) {
            case 0:
                analog_data.analogData[name] = "disabled";
                break;
            case 1:
                analog_data.analogData[name + "_current"] = readUint16(bytes, i + 1) / 1000;
                i += 2;
                break;
            case 2:
                analog_data.analogData[name + "_voltage"] = readUint16(bytes, i + 1) / 1000;
                i += 2;
                break;
            case 3:
                analog_data.analogData[name + "_level"] =
                    (readUint16(bytes, i + 1) / 1000) > 1.8 ? "HIGH" : "LOW";
                i += 2;
                break;
            default:
                break;
        }
        channel++;
    }
    if (bytes[1] === 3) {
        analog_data.controller = decodeControllerTail(bytes, tail);
    }
    return analog_data;
}

// Set point of an analog trigger: [mode] then the value as above.
function readAnalogSetPoint(bytes, i, out, key) {
    switch (bytes[i]) {
        case 0:
            out[key] = "disabled";
            return i;
        case 1:
        case 2:
            out[key] = readUint16(bytes, i + 1) / 1000;
            return i + 2;
        case 3:
            out[key] = (readUint16(bytes, i + 1) / 1000) > 1.8 ? "HIGH" : "LOW";
            return i + 2;
        default:
            return i;
    }
}

// Analog alarm frame (frame type 4), V5.0 layout, not used by the
// controllers. Per trigger: 0x0A error, 0x0B disabled, otherwise
// [T][set point mode + value][T].
function decodeAnalogAlarm(bytes) {
    var trigger_data = {};
    var i = 2;
    trigger_data.messageType = "Alarm";
    if (bytes[i] === 0x0A) {
        trigger_data.Trigger1 = "Error";
    } else if (bytes[i] === 0x0B) {
        trigger_data.Trigger1 = "Disabled";
    } else {
        trigger_data.T1 = bytes[i];
        i = readAnalogSetPoint(bytes, i + 1, trigger_data, "setPoint1");
        trigger_data.T2 = bytes[++i];
    }
    ++i; // second trigger
    if (bytes[i] === 0x0A) {
        trigger_data.Trigger2 = "Error";
    } else if (bytes[i] === 0x0B) {
        trigger_data.Trigger2 = "Disabled";
    } else {
        trigger_data.T3 = bytes[i];
        i = readAnalogSetPoint(bytes, i + 1, trigger_data, "setPoint2");
        trigger_data.T4 = bytes[++i];
    }
    return trigger_data;
}

// =====================================================================
// RS485 NODE (0) AND RS485 CONTROLLER (2)
// =====================================================================

function getRS485Data(bytes) {
    if (bytes[0] === 0) {
        return decodeBootMessage(bytes);
    } else if (bytes[0] === 1) {
        return decodeUplinkBytes(bytes);
    } else if (bytes[0] === 2) {
        return decodeResponce(bytes);
    } else if (bytes[0] === 3) {
        return decodeAlarm(bytes);
    }
    return "Error";
}

// Field header byte: bits 7..5 data type, bits 4..0 number of values.
function decodeByte(encodedByte) {
    return {
        dataType: (encodedByte >> 5) & 0x07,
        numRegisters: encodedByte & 0x1F
    };
}

// Modbus field list in bytes[start..end]. Each field is a header byte,
// then its values:
//   type 0 int16, 1 uint16 (2 bytes per value)
//   type 2 int32 ABCD, 3 int32 CDAB, 4 float ABCD, 5 float CDAB (4 bytes)
//   type 6 field disabled, 7 slave error (no value bytes)
// The fields are written into result as field1, field2, ...
function decodeModbusFields(bytes, start, end, result) {
    var fieldIndex = 1;
    for (var i = start; i <= end; i++) {
        var key = "field" + fieldIndex;
        var header = decodeByte(bytes[i]);
        var count = header.numRegisters;
        var params = [];
        var k;
        switch (header.dataType) {
            case 0:
                for (k = 0; k < count; k++) {
                    params.push(readInt16(bytes, i + 1));
                    i += 2;
                }
                result[key] = (count === 1) ? params[0] : params;
                break;
            case 1:
                for (k = 0; k < count; k++) {
                    params.push(readUint16(bytes, i + 1));
                    i += 2;
                }
                result[key] = (count === 1) ? params[0] : params;
                break;
            case 2:
            case 3:
                for (k = 0; k < count; k++) {
                    params.push(parseFloat(GetLongInt(
                        [bytes[i + 1], bytes[i + 2], bytes[i + 3], bytes[i + 4]],
                        header.dataType === 3 ? 0 : 1).toFixed(3)));
                    i += 4;
                }
                result[key] = (count === 1) ? params[0] : params;
                break;
            case 4:
            case 5:
                for (k = 0; k < count; k++) {
                    params.push(parseFloat(GetFloat(
                        [bytes[i + 1], bytes[i + 2], bytes[i + 3], bytes[i + 4]],
                        header.dataType === 5 ? 0 : 1).toFixed(3)));
                    i += 4;
                }
                result[key] = (count === 1) ? params[0] : params;
                break;
            case 6:
                result[key] = "Disabled";
                break;
            case 7:
                result[key] = "Slave Error";
                break;
            default:
                break;
        }
        fieldIndex++;
    }
    return result;
}

// Periodic frame: [0x01][device type] + 20 fields + (controller block or
// battery byte) + time stamp.
// NOTE: for a field read with Modbus function 1 or 2 (coils, discrete
// inputs) the controller sends one byte per coil byte, but this layout
// expects 2 bytes per value, so such fields do not decode correctly.
// The port 13 response sends 2 bytes per coil byte and is fine.
function decodeUplinkBytes(bytes) {
    var rs485_data = {};
    rs485_data.messageType = "Payload";
    var tail = bytes[1] === 2 ? rs485FieldsEnd(bytes) : undefined;
    var lastIndex = bytes[1] <= 1 ? bytes.length - 6 :
        ((tail !== undefined && bytes.length - tail === 6) ? tail - 1 : bytes.length - 8);
    decodeModbusFields(bytes, 2, lastIndex, rs485_data);
    if (bytes[1] === 2) {
        rs485_data.controller = decodeControllerTail(bytes, tail);
    }
    return rs485_data;
}

// =====================================================================
// RESPONSE FRAME (frame type 2): answer to a downlink
//   [0] 0x02  [1] 0x02  [2] downlink port  [3] state (0 = OK)
//   [4..]  port specific   last 4 bytes: time stamp (UTC)
// =====================================================================

function decodeResponce(bytes) {
    var responceData = {};
    responceData.messageType = "Responce";
    responceData.portNumber = bytes[2];
    responceData.status = bytes[3] === 0 ? "SUCCSESS" : "ERROR";
    if (responceData.status !== "SUCCSESS") {
        return responceData;
    }
    switch (responceData.portNumber) {
        case 5: // relay control: [4] application type, then firmware from
                // 21 Oct 2026 (10 bytes): [5] bit 0 relay 1, bit 1 relay 2;
                // older (11 bytes): [5] relay 1 [6] relay 2
            responceData.applicationType = bytes[4] === 0 ? "Single Phase" : "Three Phase";
            if (bytes.length === 10) {
                responceData.relay1 = bytes[5] & 0x01;
                responceData.relay2 = (bytes[5] >> 1) & 0x01;
            } else {
                responceData.relay1 = bytes[5];
                responceData.relay2 = bytes[6];
            }
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        case 6: // uplink interval: [4,5] seconds, or [4..7] when the
                // downlink had 4 bytes (firmware from 14 Oct 2026)
            responceData.txTime = bytes.length >= 12 ?
                readUint32(bytes, 4) : readUint16(bytes, 4);
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        case 8: // Modbus write. The controller answers a port 9 register
        case 9: // write with port 8 in byte [2] as well.
            // [4] slave ID [5] number of registers [6,7] address [8..] value
            responceData.slaveId = bytes[4];
            responceData.numberofreg = bytes[5];
            responceData.address = readUint16(bytes, 6);
            // The value is 2 or 4 bytes: take the size from the frame. The
            // controller always sends 2 bytes, the low 16 bits of the value.
            responceData.value = (bytes.length - 12 >= 4) ?
                readUint32(bytes, 8) : readUint16(bytes, 8);
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        case 10: // Modbus field stored (port 10) or read back (port 15)
            // [4] field [5] slave [6] function [7] enable [8] data type
            // [9] number of values [10,11] register address
            responceData.field = bytes[4];
            responceData.slaveId = bytes[5];
            responceData.functionCode = bytes[6];
            responceData.enable = bytes[7];
            responceData.dataType = bytes[8];
            responceData.numberOfResistors = bytes[9];
            responceData.address = readUint16(bytes, 10);
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        case 11: // alarm stored (port 11) or read back (port 14)
            // [4] slot [5..8] start [9..12] stop (seconds from midnight)
            // [13] days [14] relay [15] type [16] enable, then
            // type 2: [17..20] ON s [21..24] OFF s
            // type 3: [17..20] threshold [21] level [22] field
            //         firmware from 21 Oct 2026 (31 bytes): [23..26] Max;
            //         threshold (Min for level 2) and Max are signed x 100
            //         and decode to the real value (25.5); level 2 adds
            //         min and max. Older firmware: the whole-number
            //         threshold as stored.
            responceData.index = bytes[4];
            responceData.startTime = readUint32(bytes, 5);
            responceData.stopTime = readUint32(bytes, 9);
            responceData.dayData = bytes[13];
            responceData.relayStatus = bytes[14];
            responceData.triggerType = bytes[15];
            responceData.enable = bytes[16];
            if (responceData.triggerType === 2) {
                responceData.onTime = readUint32(bytes, 17);
                responceData.offTime = readUint32(bytes, 21);
            } else if (responceData.triggerType === 3) {
                var x100 = bytes.length >= 31;
                responceData.sensorValue = x100 ?
                    readInt32(bytes, 17) / 100 : readUint32(bytes, 17);
                responceData.level = bytes[21];
                responceData.rs485Field = bytes[22];
                if (x100 && responceData.level === 2) {
                    responceData.min = responceData.sensorValue;
                    responceData.max = readInt32(bytes, 23) / 100;
                }
            }
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        case 12: // RS485 baud rate: [4,5] baud [6] parity
            responceData.baudrate = readUint16(bytes, 4);
            responceData.parity = bytes[6];
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        case 13: // register read now: [4..] one field as in a periodic frame
            responceData.values = decodeModbusFields(bytes, 4, bytes.length - 5,
                { messageType: "Payload" });
            responceData.Systimestamp = readTimestamp(bytes);
            break;
        default:
            break;
    }
    return responceData;
}

// =====================================================================
// RS485 ALARM FRAME (frame type 3), V5.0 layout, not used by the
// controllers. Per trigger: 0x0A error, 0x0B disabled, otherwise
// [T 4 bytes][set point type + value][T 4 bytes].
// =====================================================================

function readRS485SetPoint(bytes, i, out, key) {
    switch (bytes[i]) {
        case 0:
            out[key] = readInt16(bytes, i + 1);
            return i + 2;
        case 1:
            out[key] = readUint16(bytes, i + 1);
            return i + 2;
        case 2:
        case 3:
            out[key] = parseFloat(GetLongInt(
                [bytes[i + 1], bytes[i + 2], bytes[i + 3], bytes[i + 4]],
                bytes[i] === 3 ? 0 : 1).toFixed(3));
            return i + 4;
        case 4:
        case 5:
            out[key] = parseFloat(GetFloat(
                [bytes[i + 1], bytes[i + 2], bytes[i + 3], bytes[i + 4]],
                bytes[i] === 5 ? 0 : 1).toFixed(3));
            return i + 4;
        case 10:
            out[key] = "Slave Error";
            return i;
        case 11:
            out[key] = "Disabled";
            return i;
        default:
            return i;
    }
}

function readLongAt(bytes, i) {
    return GetLongInt([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]], 1);
}

function decodeAlarm(bytes) {
    var trigger_data = {};
    var i = 2;
    trigger_data.messageType = "Alarm";
    if (bytes[i] === 0x0A) {
        trigger_data.Trigger1 = "Error";
    } else if (bytes[i] === 0x0B) {
        trigger_data.Trigger1 = "Disabled";
    } else {
        trigger_data.T1 = readLongAt(bytes, i);
        i = readRS485SetPoint(bytes, i + 4, trigger_data, "setPoint1");
        trigger_data.T2 = readLongAt(bytes, i + 1);
        i += 4;
    }
    ++i; // second trigger
    if (bytes[i] === 0x0A) {
        trigger_data.Trigger2 = "Error";
    } else if (bytes[i] === 0x0B) {
        trigger_data.Trigger2 = "Disabled";
    } else {
        trigger_data.T3 = readLongAt(bytes, i);
        i = readRS485SetPoint(bytes, i + 4, trigger_data, "setPoint2");
        trigger_data.T4 = readLongAt(bytes, i + 1);
    }
    return trigger_data;
}

// =====================================================================
// MACSENSE V2.0 (16), V5.0 layouts, not checked against firmware
// =====================================================================

function getMacSenseData(bytes) {
    if (bytes[0] === 0) {
        return decodeBootMessage(bytes);
    } else if (bytes[0] === 1) {
        return getSensorData(bytes);
    } else if (bytes[0] === 2) {
        return decodeResponce(bytes);
    } else if (bytes[0] === 3) {
        return decodeTrigerData(bytes);
    } else if (bytes[0] === 4) {
        return decodeSamplingData(bytes);
    }
}

// Sensor byte: bits 7..5 sensor code, bits 4..0 value type.
function getDataTypeAndSensor(encodedByte) {
    return {
        dataType: encodedByte & 0x1F,
        numRegisters: (encodedByte >> 5) & 0x07
    };
}

function getSensorData(bytes) {
    var sensorData = {};
    var b = bytes.slice(0, bytes.length - 5); // copy: battery + time stamp removed
    var i = 1;
    while (i < b.length - 1) {
        var decoded = getDataTypeAndSensor(b[++i]);
        var fieldName = SENSOR_FIELD_NAMES[decoded.numRegisters];
        switch (decoded.dataType) {
            case 0: // error
                sensorData[fieldName] = "Error";
                break;
            case 1: // int16: temperature and humidity / 100, pressure and level / 10
                if (fieldName === "temperature" || fieldName === "humidity") {
                    sensorData[fieldName] = parseFloat((readInt16(b, i + 1) / 100).toFixed(2));
                    i += 2;
                } else if (fieldName === "pressure" || fieldName === "level") {
                    sensorData[fieldName] = parseFloat((readInt16(b, i + 1) / 10).toFixed(2));
                    i += 2;
                }
                break;
            case 2:
                sensorData[fieldName] = parseFloat(readUint16(b, i + 1).toFixed(2));
                i += 2;
                break;
            case 3:
                sensorData[fieldName] = parseFloat((readUint16(b, i + 1) / 100).toFixed(2));
                i += 2;
                break;
            default:
                break;
        }
    }
    return sensorData;
}

function decodeTrigerData(bytes) {
    var triggerData = {};
    triggerData.threshould1 = parseFloat(GetFloatFromBytes(bytes.slice(2, 6), 1).toFixed(3));
    triggerData[SENSOR_FIELD_NAMES[bytes[6]]] =
        parseFloat(GetFloatFromBytes(bytes.slice(7, 11), 1).toFixed(3));
    triggerData.threshould2 = parseFloat(GetFloatFromBytes(bytes.slice(11, 15), 1).toFixed(3));
    return triggerData;
}

function decodeSamplingData(bytes) {
    var sampleData = {};
    var fieldIndex = 1;
    var lastIndex = bytes.length - 8;
    sampleData.parameter = SENSOR_FIELD_NAMES[bytes[2]];
    sampleData.noofsamples = bytes[3];
    var i = 3;
    while (i <= lastIndex) {
        var key = sampleData.parameter + fieldIndex++;
        if (bytes[i] !== 0xFF) {
            sampleData[key] = parseFloat(
                GetFloatFromBytes(bytes.slice(i + 1, i + 5), 1).toFixed(3));
            i += 4;
        } else {
            sampleData[key] = "Error";
            i += 1;
        }
    }
    sampleData.battery = bytes[i + 1] / 10;
    sampleData.Systimestamp = readUint32(bytes, i + 2);
    return sampleData;
}

// =====================================================================
// DOWNLINK ENCODER
// The FPort selects the command (controller firmware, OnRxData):
//    5  relay control, with response    relay1, relay2: 0 off, 1 on, both
//                                       needed; sent as one byte (bit 0
//                                       relay 1, bit 1 relay 2), which sets
//                                       both relays (firmware from
//                                       21 Oct 2026)
//    6  uplink interval                 txTime: 10 .. 86400 s (firmware
//                                       before 23 Oct 2026: from 30); above
//                                       65535 s it goes out as 4 bytes,
//                                       which needs firmware from
//                                       14 Oct 2026
//    7  relay control, no response      as port 5; in three phase relay1
//                                       1 gives START, 0 gives STOP
//    8  Modbus coil write               slaveId, numberofreg, address, value
//    9  Modbus register write           as port 8 (value 4 bytes when
//                                       numberofreg is not 1)
//   10  store a Modbus field            Field 1..20, slaveId, functionCode,
//                                       Enable, dataType, numberOfParameters,
//                                       Registeraddress
//   11  store an alarm                  index 0..9, startTime, stopTime,
//                                       dayData, relayStatus, alarmType 1..3,
//                                       enable; type 2: onTime, offTime;
//                                       type 3: condition, rs485Field and
//                                       threshold (condition 0 / 1) or min
//                                       and max (condition 2), real values
//                                       with up to 2 decimals (firmware
//                                       from 21 Oct 2026); or sensorValue,
//                                       a whole number in the older format
//   12  RS485 baud rate and parity      baud 1200..65535, pairity 0..2
//   13  read a register now             slaveId, functionCode, dataType,
//                                       numberOfParameters, Registeraddress
//   14  read an alarm back              index 0..9
//   15  read a Modbus field back        index 1..20
//   17  ADR                             adr 1 on, 0 off
//   18  message type                    msgtype 1 confirmed, 0 unconfirmed
//                                       (17 and 18 as on the SHT40 node,
//                                       firmware from 23 Oct 2026)
//   19  ADR, SF and message type        adr 0..1, sf 7..12, msgtype 0..1
//                                       (as on the SHT40 node, firmware
//                                       from 27 Oct 2026)
//   21  sampling settings              param 0 field / channel 1,
//                                       1 field / channel 2 (2 both is
//                                       no longer sent, 27 Oct 2026);
//                                       count 2..12, enable 0..1,
//                                       interval 30..3600 s (optional;
//                                       without it the stored one stays)
//                                       (firmware from 22 Oct 2026)
// A value out of range raises an error instead of sending a bad downlink.
// =====================================================================

function requireInt(value, name, min, max) {
    var v = Number(value);
    if (value === undefined || value === null || value === "" ||
        isNaN(v) || Math.floor(v) !== v || v < min || v > max) {
        throw new Error(name + " must be a whole number from " + min + " to " + max);
    }
    return v;
}

// A real value with up to 2 decimals, returned x 100 as a whole number
// (25.5 -> 2550, -5 -> -500), as the trigger limits travel since
// 21 Oct 2026.
function requireHundredths(value, name) {
    var v = Number(value);
    if (value === undefined || value === null || value === "" || isNaN(v) ||
        v < -21474836.48 || v > 21474836.47) {
        throw new Error(name + " must be a number from -21474836.48 to 21474836.47");
    }
    var h = Math.round(v * 100);
    if (Math.abs(h - v * 100) > 1e-6 * Math.max(1, Math.abs(v * 100))) {
        throw new Error(name + " can have at most 2 decimals");
    }
    return h;
}

function pushUint16(bytes, value) {
    bytes.push((value >> 8) & 0xFF, value & 0xFF);
}

function pushUint32(bytes, value) {
    bytes.push((value >> 24) & 0xFF, (value >> 16) & 0xFF,
        (value >> 8) & 0xFF, value & 0xFF);
}

// First value that is not undefined: lets the old and the corrected key
// names both work ("pairity" / "parity", "condition" / "level").
function pick(a, b) {
    return a !== undefined ? a : b;
}

function encodeDownlink(input) {
    var data = input.data || {};
    var port = Number(pick(data.fPort, data.port));
    var bytes = [];

    switch (port) {
        case 5: // relay control: one byte, bit 0 relay 1, bit 1 relay 2,
        case 7: // it sets both relays (firmware from 21 Oct 2026)
            bytes.push(requireInt(data.relay1, "relay1", 0, 1) |
                (requireInt(data.relay2, "relay2", 0, 1) << 1));
            break;

        case 6: // uplink interval: 2 bytes up to 65535 s (every firmware),
                // 4 bytes above, up to 86400 s (firmware from 14 Oct 2026)
            var txTime = requireInt(data.txTime, "txTime", 10, 86400);
            if (txTime > 65535) {
                pushUint32(bytes, txTime);
            } else {
                pushUint16(bytes, txTime);
            }
            break;

        case 8: // Modbus coil write
        case 9: // Modbus register write
            bytes.push(
                requireInt(data.slaveId, "slaveId", 0, 255),
                requireInt(data.numberofreg, "numberofreg", 1, 255));
            pushUint16(bytes, requireInt(data.address, "address", 0, 65535));
            if (Number(data.numberofreg) === 1) {
                pushUint16(bytes, requireInt(data.value, "value", -32768, 65535));
            } else {
                pushUint32(bytes, requireInt(data.value, "value", -2147483648, 4294967295));
            }
            break;

        case 10: // store a Modbus field
            bytes.push(
                requireInt(data.Field, "Field", 1, 20),
                requireInt(data.slaveId, "slaveId", 0, 255),
                requireInt(data.functionCode, "functionCode", 0, 255),
                requireInt(data.Enable, "Enable", 0, 1),
                requireInt(data.dataType, "dataType", 0, 7),
                requireInt(data.numberOfParameters, "numberOfParameters", 0, 31));
            pushUint16(bytes, requireInt(data.Registeraddress, "Registeraddress", 0, 65535));
            break;

        case 11: // store an alarm
            var alarmType = requireInt(data.alarmType, "alarmType", 1, 3);
            bytes.push(requireInt(data.index, "index", 0, 9));
            pushUint32(bytes, requireInt(data.startTime, "startTime", 0, 86400));
            pushUint32(bytes, requireInt(data.stopTime, "stopTime", 0, 86400));
            bytes.push(
                requireInt(data.dayData, "dayData", 0, 255),
                requireInt(data.relayStatus, "relayStatus", 0, 2),
                alarmType,
                requireInt(data.enable, "enable", 0, 1));
            if (alarmType === 2) { // cyclic
                pushUint32(bytes, requireInt(data.onTime, "onTime", 0, 86400));
                pushUint32(bytes, requireInt(data.offTime, "offTime", 0, 86400));
                if (Number(data.onTime) + Number(data.offTime) === 0) {
                    throw new Error("onTime and offTime cannot both be 0");
                }
            } else if (alarmType === 3) { // trigger
                var condition = requireInt(pick(data.condition, data.level), "condition", 0, 255);
                var field = requireInt(data.rs485Field, "rs485Field", 0, 255);
                if (data.threshold !== undefined || data.min !== undefined ||
                    data.max !== undefined) {
                    // firmware from 21 Oct 2026: limits x 100 with sign,
                    // between with the user's Min and Max (23 bytes)
                    var low, high = 0;
                    if (condition === 2) {
                        low = requireHundredths(data.min, "min");
                        high = requireHundredths(data.max, "max");
                        if (low > high) {
                            throw new Error("min cannot be above max");
                        }
                    } else {
                        low = requireHundredths(data.threshold, "threshold");
                    }
                    pushUint32(bytes, low);
                    bytes.push(condition, field);
                    pushUint32(bytes, high);
                } else {
                    // older format (19 bytes): whole-number threshold,
                    // condition 2 between the fixed limits 10 and 40
                    pushUint32(bytes, requireInt(data.sensorValue, "sensorValue", -2147483648, 4294967295));
                    bytes.push(condition, field);
                }
            }
            break;

        case 12: // RS485 baud rate and parity
            // The controller takes the baud rate as 16 bits, so 115200
            // cannot be set with this downlink (use AT+BAUD).
            pushUint16(bytes, requireInt(data.baud, "baud", 1200, 65535));
            bytes.push(requireInt(pick(data.pairity, data.parity), "pairity", 0, 2));
            break;

        case 13: // read a register now
            bytes.push(
                requireInt(data.slaveId, "slaveId", 0, 255),
                requireInt(data.functionCode, "functionCode", 0, 255),
                requireInt(data.dataType, "dataType", 0, 7),
                requireInt(data.numberOfParameters, "numberOfParameters", 1, 31));
            pushUint16(bytes, requireInt(data.Registeraddress, "Registeraddress", 0, 65535));
            break;

        case 14: // read an alarm back
            bytes.push(requireInt(data.index, "index", 0, 9));
            break;

        case 15: // read a Modbus field back
            bytes.push(requireInt(data.index, "index", 1, 20));
            break;

        case 17: // ADR, the byte of the SHT40 node (firmware from 23 Oct 2026)
            bytes.push(requireInt(data.adr, "adr", 0, 1));
            break;

        case 18: // message type, as on the SHT40 node (firmware from 23 Oct 2026)
            bytes.push(requireInt(data.msgtype, "msgtype", 0, 1));
            break;

        case 19: // ADR, SF and message type, the SHT40 bytes; the SF goes out
                 // as it is (firmware from 27 Oct 2026)
            bytes.push(
                requireInt(data.adr, "adr", 0, 1),
                requireInt(data.sf, "sf", 7, 12),
                requireInt(data.msgtype, "msgtype", 0, 1));
            break;

        case 21: // sampling settings, the bytes of the MY-L1-CV-X1 node
            bytes.push(
                // 0 / 1 only: "both" (2) was removed from the controller
                // on 27 Oct 2026, its frame is too big for SF10 - SF12
                requireInt(data.param, "param", 0, 1),
                requireInt(data.count, "count", 2, 12),
                requireInt(data.enable, "enable", 0, 1));
            if (data.interval !== undefined) {
                pushUint16(bytes, requireInt(data.interval, "interval", 30, 3600));
            }
            break;

        default:
            throw new Error("fPort " + pick(data.fPort, data.port) +
                " is not a controller command port (5 to 15, 17 to 19, 21)");
    }
    return {
        fPort: port,
        bytes: bytes
    };
}

/*
 * Changes from V5.0
 *  1. Decode() for the Milesight gateway passed the byte array where an
 *     object was expected and failed on every uplink.
 *  2. decodeUplink() read input.port, which does not exist: uplinkPort was
 *     always empty. It is input.fPort.
 *  3. Undeclared variables: byteIndex and fieldIndex are errors only where
 *     a codec runs in strict mode (the user's ChirpStack ran V5.0 fine);
 *     numberofreg and fieldNames made the port 9 response and the MacSense
 *     trigger and sample frames fail everywhere.
 *  4. Controller boot frame: the controller sends the hardware version
 *     first and the firmware version second; FR and HW were swapped.
 *     TDCM is the uplink interval in seconds, not milliseconds.
 *  5. Controller periodic frame: deviceinfo.battery was the relay 2 byte
 *     divided by 10. Controllers have no battery; the key is left out.
 *  6. Modbus write response: the value is taken as 2 or 4 bytes from the
 *     frame length. With more than one register V5.0 read 4 bytes while
 *     the controller sends 2, which also broke the time stamp.
 *  7. Port 13 response: the time stamp was read from the data bytes.
 *  8. Analog alarm frame, level set point: wrote into an object that did
 *     not exist.
 *  9. Time stamps are read unsigned.
 * 10. Encoder: port 7 added; values are checked against the ranges the
 *     firmware accepts; an unknown port raises an error instead of an
 *     empty downlink; "parity" and "level" are accepted as well as
 *     "pairity" and "condition".
 * 11. getSensorData() no longer cuts the caller's byte array.
 * 12. Boot frame: FR and HW are plain numbers, "1.0.0", as in the SHT40
 *     codec. V5.0 wrote each byte as two hex digits, "01.00.00".
 * 13. Port 6 (14 Oct 2026): txTime up to 86400 s. Above 65535 s the
 *     encoder sends 4 bytes and the response carries 4 bytes; up to
 *     65535 s nothing changes, so older firmware still works.
 * 14. Relay event uplink on FPort 4 (15 Oct 2026): decoded as relayEvent
 *     (relay states, what changed, cause, schedule slot and type).
 * 15. Relay event reasons (19 Oct 2026): a 36-byte event adds
 *     relay1Reason / relay2Reason for each relay that changed, and for a
 *     trigger schedule relay1Trigger / relay2Trigger (field, condition,
 *     value, threshold). A relay that went OFF names the schedule that
 *     held it ON. 14-byte events from older firmware decode as before.
 * 16. Trigger Min / Max and decimals (21 Oct 2026). Trigger limits travel
 *     x 100 with sign. Encoder port 11: threshold (condition 0 / 1) or min
 *     and max (condition 2) as real values send the 23-byte format;
 *     sensorValue still sends the older 19-byte one. Port 11 / 14
 *     responses of 31 bytes decode sensorValue as the real value and, for
 *     condition 2, min and max. 44-byte relay events give a between
 *     trigger's min and max. Older frames decode as before.
 * 17. Relay states in one byte, bit 0 relay 1, bit 1 relay 2 (21 Oct 2026):
 *     periodic frames (found by walking the 20 RS485 fields or the 2
 *     analog channels: 2 bytes before the time stamp instead of 3), the
 *     10-byte port 5 response and the 13 / 35 / 43-byte relay events.
 *     Older frames decode as before. Encoder port 5 / 7: relay1 and relay2
 *     (0 / 1) are both needed and go out as that one byte, which sets both
 *     relays.
 * 18. Sampling (22 Oct 2026), as on the MacSync MY-L1-CV-X1 node: FPort 3
 *     readings decode as sampling (source, sampleCount, inputs with field
 *     or channel, type and samples), the FPort 21 echo as samplingConfig.
 *     Only frames of exactly that node's layout are taken on FPort 3. Encoder
 *     port 21: param, count, enable and the optional interval.
 * 19. Port 6 (23 Oct 2026): txTime from 10 s (was 30). Firmware before
 *     23 Oct 2026 answers a value below 30 with an ERROR response.
 * 20. ADR and message type (23 Oct 2026), as on the MacSync MY-L1-TH-X1
 *     (SHT40) node: encoder port 17 (adr 0 / 1) and port 18 (msgtype
 *     0 / 1), one byte each. The 2-byte echo on FPort 17 / 18 decodes as
 *     lorawanConfig (adr ON / OFF, msgtype CONFIRMED / UNCONFIRMED). Older
 *     firmware ignores these ports and sends no echo.
 * 21. MSGINFO (27 Oct 2026), as on the SHT40 node: encoder port 19 (adr
 *     0 / 1, sf 7..12, msgtype 0 / 1), three bytes, the SF as it is. The
 *     4-byte echo on FPort 19 decodes as lorawanConfig with adr, sf and
 *     msgtype. Firmware before 27 Oct 2026 ignores port 19.
 * 22. Responses on the downlink's FPort (27 Oct 2026): the controller
 *     answers each downlink on the FPort it came on, unconfirmed, as the
 *     SHT40 node does (before: FPort 2, confirmed). No decoder change was
 *     needed: a response frame (02 02 ...) decodes the same on every FPort.
 * 23. Sampling "both" removed (27 Oct 2026, later build): the controller
 *     samples one input only (frame 9 + 4 n bytes, at most 57). Encoder port
 *     21: param 0 or 1; 2 raises an error. The decoder still reads "both"
 *     frames and echoes from older firmware and the MY-L1-CV-X1 node.
 * 24. New model numbers and platform files (28 Oct 2026): the comments use
 *     MS-L5-CT-X1 (was MS-LPC-ST-X1), MY-L1-CV-X1 (was MS-LBS-STD-X1) and
 *     MY-L1-TH-X1 (was MS-LBS-TH-X1). MS_L5_CT_X1_TTN.js and
 *     MS_L5_CT_X1_Milesight.js hold the same codec for The Things Stack and
 *     the Milesight gateway; they read floats and 32-bit integers without
 *     DataView, so they also run on ES5 engines, with the same results.
 *     The Milesight file adds Encode(fPort, obj). No change to the output.
 */
