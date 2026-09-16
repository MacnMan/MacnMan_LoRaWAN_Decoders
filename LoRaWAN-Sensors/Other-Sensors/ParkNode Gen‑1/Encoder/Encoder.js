/**
 * LoRaWAN Downlink Encoder for ParkNode Gen-1 (parking occupancy sensor)
 * Macnman Technologies Pvt. Ltd.
 * Works on TTN / ChirpStack / Milesight — encodeDownlink(input)
 *
 * DOWNLINK ports:
 *    3  Switch LoRaWAN class      { "class": 0|1|2 }        (A / B / C)
 *    6  Event TX interval (s)     { "txTime": 600 }         (min 10 s)
 *    7  Board reset               { "reset": 1 }            (payload ignored)
 *   11  Heartbeat uplink interval { "uplinkTime": 3600 }    (min 300 s)
 *   12  ADR + Data rate           { "adr": 0|1, "dr": 0..5 } (device reboots)
 *   13  Message type              { "msgtype": 0|1 }        (0 unconf, 1 conf)
 */
function encodeDownlink(input) {
    var d = input.data;
    var portNumber = (d && d.fPort !== undefined) ? d.fPort : input.fPort;
    var bytes = [];

    switch (portNumber) {
        case 3: // LoRaWAN class: 0 = Class A, 1 = Class B, 2 = Class C
            bytes = [d["class"] & 0xFF];
            break;

        case 6: // event / status-change TX interval in seconds (>= 10)
            bytes = [(d.txTime >> 8) & 0xFF, d.txTime & 0xFF];
            break;

        case 7: // board reset — payload content is ignored by firmware
            bytes = [0x01];
            break;

        case 11: // heartbeat uplink interval in seconds (>= 300)
            bytes = [(d.uplinkTime >> 8) & 0xFF, d.uplinkTime & 0xFF];
            break;

        case 12: // ADR (0/1) + data rate (0..5) — device reboots to apply
            bytes = [d.adr & 0x01, d.dr & 0xFF];
            break;

        case 13: // message type: 0 = unconfirmed, 1 = confirmed
            bytes = [d.msgtype & 0x01];
            break;

        default:
            return { bytes: [], fPort: portNumber, errors: ["unknown fPort " + portNumber] };
    }
    return { fPort: portNumber, bytes: bytes };
}

// Lets the LNS show a queued downlink back as JSON
function decodeDownlink(input) {
    var b = input.bytes, o = {};
    switch (input.fPort) {
        case 3:  o["class"] = b[0]; break;
        case 6:  o.txTime = (b[0] << 8) | b[1]; break;
        case 7:  o.reset = 1; break;
        case 11: o.uplinkTime = (b[0] << 8) | b[1]; break;
        case 12: o.adr = b[0]; o.dr = b[1]; break;
        case 13: o.msgtype = b[0]; break;
    }
    return { data: o };
}
