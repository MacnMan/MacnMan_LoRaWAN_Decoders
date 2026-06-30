/**
 * LoRaWAN Decoder for parkomate
 * Macnman Technologies Pvt.Ltd
 * Writen By : MACNMAN
 * Target : Milesight Gateway (built-in Network Server)
*/

// Milesight gateway entry point: Decode(fPort, bytes)
function Decode(fPort, bytes) {
    return {
        Payload: Decoder(bytes, fPort)
    };
}

// Convert bytes to signed 16-bit integer
function toSigned16(unsignedValue) {
  return (unsignedValue & 0x8000) ? -(0x10000 - unsignedValue) : unsignedValue;
}

// decoding uploaded data
function Decoder(bytes, port) {
    var dataIndex = 0;

    // -------------------------------------------------------------
    // TILT TAMPER ALERT CHECK
    // If the first byte is 0x0F (15), we know it's the 6-byte tamper alert!
    // -------------------------------------------------------------
    if (bytes[0] === 0x0F && bytes.length === 6) {
        var tamper_timestamp = (bytes[2] << 24) + (bytes[3] << 16) + (bytes[4] << 8) + bytes[5];
        return {
            "devId": 0x0F,
            "msgType": "tamper_alert",   // Identifies this as an emergency alert
            "tamperStatus": bytes[1] === 0x01 ? true : false, // true = Tampered!
            "Systimestamp": tamper_timestamp,
            "length": bytes.length,
            "oem": "MACNMAN",
            "device": "ParkNode_LWAN_V1.0",
            "version": "1.0"
        };
    }
    // -------------------------------------------------------------

    // If it's NOT a tamper alert, proceed with normal expected parking logic
    var payloadData = {
        "devId": bytes[dataIndex++],
        // In firmware 0x00 is Trigger/Event, 0x01 is Normal/Heartbeat
        "msgType": bytes[dataIndex++] === 0x00 ? "event" : "heartbeat",
        "length": bytes.length,
        "oem": "MACNMAN",
        "device": "ParkNode_LWAN_V1.0",
        "version": "1.0"
    };

    payloadData.sensorInfo = {};
    payloadData.parkStatus = bytes[dataIndex++] === 0x01 ? true : false;
    payloadData.battery = bytes[dataIndex++];

    // Parse normal System Timestamp
    payloadData.Systimestamp = (bytes[dataIndex++] << 24) + (bytes[dataIndex++] << 16) + (bytes[dataIndex++] << 8) + bytes[dataIndex++];

    return payloadData;
}