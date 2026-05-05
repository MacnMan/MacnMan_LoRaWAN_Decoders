// main function for milesight gateway decoder
function Decode(fPort, bytes) {
    return decodeUplink(bytes);
}
// bytes to string
function str_pad(byte) {
    var zero = '00';
    var hex = byte.toString(16);
    var tmp = 2 - hex.length;
    return zero.substr(0, tmp) + hex + "";
}
// function for decoding uplink message
function decodeUplink(input) {
    var devData = {};
    switch (input[0]) {
        case 0:
            devData.deInfo = decodeBootMessage(input);
            break;
        case 1:
            devData.deInfo = getDeviceinfo(input);
            devData.Payload = getMacSenseData(input);
            break;
    }
    return devData;
}
// Function for returning decode encoded data take 1 byte as argument last 2 bits are data type and other 6 are type sensor.
function getDataTypeAndSensor(encodedByte) {
    let numRegisters = (encodedByte >> 5) & 0x07; // Extract 3-bit Data Type
    let dataType = encodedByte & 0x1F; // Extract 5-bit Register Count
    return {
        dataType,
        numRegisters
    };
}
// Returns parameter and its value.
function getSensorData(bytes) {
    var fieldNames = ["level", "temperature", "humidity", "pressure", "windspeed", "winddirection", "rainfall", "snowfall", "co2", "pm2.5", "levelmm", "levelcm", "levelm3"];
    var sensorData = {};
    bytes.splice(-5);
    const loopCount = (bytes.length);
    let byteIndex;
    for (byteIndex = 1; byteIndex < loopCount-1; ) {
        var decodedData = getDataTypeAndSensor(bytes[++byteIndex]);
        var dataType = decodedData.dataType;
        var fieldIndex = decodedData.numRegisters;
        let fieldName = fieldNames[fieldIndex];
        switch (dataType) {
            case 0: // error
                    sensorData[fieldName] = "Error";
            break;
            case 1: // int16/100 and int16/10 with signed
                switch (fieldName) {
                case "temperature":
                    sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 100).toFixed(2));
                    break
                case "humidity":
                    sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 100).toFixed(2));
                    break
                case "pressure":
                    sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 10).toFixed(2));
                    break
                case "level":
                    sensorData[fieldName] = parseFloat(((((bytes[++byteIndex] << 8) | bytes[++byteIndex]) << 16 >> 16) / 10).toFixed(2));
                    break
                }      
            break;
            case 2: // uint32
                    sensorData[fieldName] = parseFloat((((bytes[++byteIndex] << 8) | bytes[++byteIndex])).toFixed(2))
            break;
            case 3: // float32
                    sensorData[fieldName] = parseFloat((((bytes[++byteIndex] << 8) | bytes[++byteIndex])/100).toFixed(2))
            break;
        }
    }
    // sensorData.battery = ((bytes[byteIndex]) / 10);
    // sensorData.Systimestamp = (bytes[++byteIndex] << 24) + (bytes[++byteIndex] << 16) + (bytes[++byteIndex] << 8) + bytes[++byteIndex];
    return sensorData;
}
// for decoding data from new sensors with its id.
function getMacSenseData(bytes) {
    if (bytes[0] === 0) {
        return decodeBootMessage(bytes); // decode boot message bytes
    } else if (bytes[0] == 1) {
        return getSensorData(bytes);
    } else if (bytes[0] == 2) {
        return decodeResponce(bytes);
    } else if (bytes[0] == 3) {
        return decodeTrigerData(bytes);
    } else if (bytes[0] == 4) {
        return decodeSamplingData(bytes);
    }

}
//
function getDeviceinfo(bytes, port) {
    var devInfo = {};
    devInfo.manufacturer = "Macnman India",
        devInfo.protocall = "LoRaWAN",
        devInfo.uplinkPort = port,
        devInfo.deviceID = bytes[1],
        // devInfo.devType = devTypes[bytes[1]];
    byteIndex = bytes.length - 6;
    devInfo.battery = ((bytes[++byteIndex]) / 10);
    devInfo.Systimestamp = (bytes[++byteIndex] << 24) + (bytes[++byteIndex] << 16) + (bytes[++byteIndex] << 8) + bytes[++byteIndex];
    return devInfo;
}
//
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