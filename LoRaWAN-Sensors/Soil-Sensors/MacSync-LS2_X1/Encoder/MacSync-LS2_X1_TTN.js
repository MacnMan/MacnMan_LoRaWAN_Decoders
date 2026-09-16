// TTN downlink Encoder MacSync-LS2_X1.
function encodeDownlink(input) {
    var portNumber = (input.data && input.data.fPort !== undefined) ? input.data.fPort : input.fPort;
    var bytes = [];

    switch (portNumber) {
        case 6: // for tx time (uplink interval, seconds)
            bytes.push(
                (input.data.txTime >> 8) & 0xFF,
                input.data.txTime & 0xFF
            );
            break;
        default:
            break;
    }
    return {
        fPort: portNumber,
        bytes: bytes
    };
}

// Lets the LNS show a queued downlink back as JSON
function decodeDownlink(input) {
    var o = {};
    if (input.fPort === 6) {
        o.txTime = (input.bytes[0] << 8) | input.bytes[1];
    }
    return { data: o };
}
