/**
 * LoRaWAN Decoder for MacSync-LPS28 (LPS28DFW pressure / level sensor)
 * Macnman Technologies Pvt. Ltd.
 * Target : TTN (The Things Network) — decodeUplink(input)
 * Same wire format as the Milesight decoder; only the entry point differs.
*/

// bytes to string
function str_pad(byte) {
    var zero = '00';
    var hex = byte.toString(16);
    var tmp = 2 - hex.length;
    return zero.substr(0, tmp) + hex + "";
}

// Function for returning decoded data: 1 tag byte — high 3 bits are the
// field index, low 5 bits are the data type.
function getDataTypeAndSensor(encodedByte) {
    var numRegisters = (encodedByte >> 5) & 0x07; // field index
    var dataType = encodedByte & 0x1F;            // data type
    return {
        dataType: dataType,
        numRegisters: numRegisters
    };
}

// Returns parameter and its value.
function getSensorData(bytes) {
    var fieldNames = ["level", "temperature", "humidity", "pressure", "windspeed", "winddirection", "rainfall", "snowfall", "co2", "pm2.5", "levelmm", "levelcm", "levelm3"];
    var sensorData = {};
    bytes = bytes.slice(0, bytes.length - 5);   // drop battery + timestamp trailer
    var loopCount = bytes.length;
    var byteIndex;
    for (byteIndex = 1; byteIndex < loopCount - 1;) {
        var decodedData = getDataTypeAndSensor(bytes[++byteIndex]);
        var dataType = decodedData.dataType;
        var fieldIndex = decodedData.numRegisters;
        var fieldName = fieldNames[fieldIndex];
        switch (dataType) {
            case 0: // error
                sensorData[fieldName] = "Error";
                break;
            case 1: // int16/100 and int16/10 with signed
                switch (fieldName) {
                    case "temperature":
                        sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 100).toFixed(2));
                        break;
                    case "humidity":
                        sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 100).toFixed(2));
                        break;
                    case "pressure":
                        sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 10).toFixed(2));
                        break;
                    case "level":
                        sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 10).toFixed(2));
                        break;
                }
                break;
            case 2: // uint16
                sensorData[fieldName] = parseFloat((((bytes[++byteIndex] << 8) | bytes[++byteIndex])).toFixed(2));
                break;
            case 3: // uint16 / 100
                sensorData[fieldName] = parseFloat((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) / 100).toFixed(2));
                break;
        }
    }
    return sensorData;
}

// for decoding data from new sensors with its id.
function getMacSenseData(bytes) {
    if (bytes[0] === 0) {
        return decodeBootMessage(bytes); // decode boot message bytes
    } else if (bytes[0] == 1) {
        return getSensorData(bytes);
    } else {
        // 2 = config response, 3 = trigger, 4 = sampling — not used by this
        // device build; expose the raw frame instead of failing.
        return { messageType: "unsupported_frame", frameId: bytes[0] };
    }
}

// device info common to data frames: battery + timestamp trailer
function getDeviceinfo(bytes, port) {
    var devInfo = {};
    devInfo.manufacturer = "Macnman India";
    devInfo.protocall = "LoRaWAN";
    devInfo.uplinkPort = port;
    devInfo.deviceID = bytes[1];
    var byteIndex = bytes.length - 6;
    devInfo.battery = ((bytes[++byteIndex]) / 10);
    devInfo.Systimestamp = (bytes[++byteIndex] << 24) + (bytes[++byteIndex] << 16) + (bytes[++byteIndex] << 8) + bytes[++byteIndex];
    return devInfo;
}

// boot frame: OEM id + firmware/hardware version + TX interval + timestamp
function decodeBootMessage(bytes) {
    var boot_data = {};
    var fieldIndex = 1;
    boot_data.messageType = "Boot Message";
    boot_data.OEM_ID = str_pad(bytes[++fieldIndex]) + str_pad(bytes[++fieldIndex]) + str_pad(bytes[++fieldIndex]) + str_pad(bytes[++fieldIndex]);
    boot_data.FR = str_pad(bytes[++fieldIndex]) + "." + str_pad(bytes[++fieldIndex]) + "." + str_pad(bytes[++fieldIndex]);
    boot_data.HW = str_pad(bytes[++fieldIndex]) + "." + str_pad(bytes[++fieldIndex]) + "." + str_pad(bytes[++fieldIndex]);
    boot_data.TDCM = (bytes[++fieldIndex] << 8 | bytes[++fieldIndex]); //millisec
    boot_data.Systimestamp = (bytes[++fieldIndex] << 24) + (bytes[++fieldIndex] << 16) + (bytes[++fieldIndex] << 8) + bytes[++fieldIndex];
    return boot_data;
}

// TTN entry point
function decodeUplink(input) {
    var bytes = input.bytes;
    var devData = {};
    switch (bytes[0]) {
        case 0:
            devData.deInfo = decodeBootMessage(bytes);
            break;
        case 1:
            devData.deInfo = getDeviceinfo(bytes, input.fPort);
            devData.Payload = getMacSenseData(bytes);
            break;
    }
    return { data: devData };
}
