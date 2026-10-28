// ===================================================================
// MacSet MS-L5-CT-X1 relay controller - standalone DOWNLINK ENCODER
// Codec V5.1. The same JSON keys and checks as the codec files in
// ../Decoder (those also hold this encoder, with the uplink decoder).
// Put the FPort in the JSON as "port" (or "fPort") and send the downlink
// on that same FPort. encodeDownlink(input) returns { fPort, bytes }; a
// value out of range raises an error instead of sending a bad downlink.
// The device runs in Class C: set the device profile to Class C too.
//
// Examples, JSON -> downlink bytes (hex):
//   5  relays
//      {"port":5,"relay1":1,"relay2":0}
//      -> 01
//   6  uplink interval
//      {"port":6,"txTime":3600}
//      -> 0E 10
//   6  uplink interval above 65535 s
//      {"port":6,"txTime":86400}
//      -> 00 01 51 80
//   7  relays, no answer
//      {"port":7,"relay1":0,"relay2":1}
//      -> 02
//   8  Modbus coil write
//      {"port":8,"slaveId":1,"numberofreg":1,"address":16,"value":65280}
//      -> 01 01 00 10 FF 00
//   9  Modbus register write
//      {"port":9,"slaveId":1,"numberofreg":1,"address":100,"value":1500}
//      -> 01 01 00 64 05 DC
//  10  store a Modbus field
//      {"port":10,"Field":1,"slaveId":1,"functionCode":3,"Enable":1,"dataType":0,"numberOfParameters":1,"Registeraddress":1}
//      -> 01 01 03 01 00 01 00 01
//  11  regular schedule
//      {"port":11,"index":0,"startTime":21600,"stopTime":64800,"dayData":127,"relayStatus":0,"alarmType":1,"enable":1}
//      -> 00 00 00 54 60 00 00 FD 20 7F 00 01 01
//  11  cyclic schedule
//      {"port":11,"index":1,"startTime":0,"stopTime":86400,"dayData":127,"relayStatus":1,"alarmType":2,"enable":1,"onTime":600,"offTime":1200}
//      -> 01 00 00 00 00 00 01 51 80 7F 01 02 01 00 00 02 58 00 00 04 B0
//  11  trigger, above a threshold
//      {"port":11,"index":2,"startTime":0,"stopTime":86400,"dayData":127,"relayStatus":1,"alarmType":3,"enable":1,"condition":0,"rs485Field":1,"threshold":25.5}
//      -> 02 00 00 00 00 00 01 51 80 7F 01 03 01 00 00 09 F6 00 01 00 00 00 00
//  11  trigger, between Min and Max
//      {"port":11,"index":3,"startTime":0,"stopTime":86400,"dayData":127,"relayStatus":2,"alarmType":3,"enable":1,"condition":2,"rs485Field":2,"min":-5,"max":40.25}
//      -> 03 00 00 00 00 00 01 51 80 7F 02 03 01 FF FF FE 0C 02 02 00 00 0F B9
//  12  RS485 baud / parity
//      {"port":12,"baud":9600,"parity":0}
//      -> 25 80 00
//  13  read registers now
//      {"port":13,"slaveId":1,"functionCode":3,"dataType":0,"numberOfParameters":2,"Registeraddress":1}
//      -> 01 03 00 02 00 01
//  14  read a schedule
//      {"port":14,"index":0}
//      -> 00
//  15  read a Modbus field
//      {"port":15,"index":1}
//      -> 01
//  17  ADR
//      {"port":17,"adr":1}
//      -> 01
//  18  message type
//      {"port":18,"msgtype":0}
//      -> 00
//  19  ADR + SF + message type
//      {"port":19,"adr":0,"sf":9,"msgtype":1}
//      -> 00 09 01
//  21  sampling
//      {"port":21,"param":0,"count":6,"enable":1,"interval":60}
//      -> 00 06 01 00 3C
// ===================================================================

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
