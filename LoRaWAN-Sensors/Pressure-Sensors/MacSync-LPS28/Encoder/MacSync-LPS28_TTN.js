// TTN downlink Encoder MacSync-LPS28.
function encodeDownlink(input) {
    const portNumber = input.data.fPort;
    let bytes = [];

    switch (portNumber) {
        case 6: // for tx time
            bytes.push(
                (input.data.txTime >> 8) & 0xFF,
                input.data.txTime & 0xFF,
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