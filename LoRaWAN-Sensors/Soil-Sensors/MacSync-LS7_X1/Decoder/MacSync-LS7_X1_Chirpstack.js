function str_pad(n)
{
    return n.toString().padStart(2, '0');
}

function decodeBootMessage(bytes)
{
    var boot_data = {};

    var fieldIndex = 1;

    boot_data.messageType = "Boot Message";

    boot_data.OEM_ID =
        str_pad(bytes[++fieldIndex]) +
        str_pad(bytes[++fieldIndex]) +
        str_pad(bytes[++fieldIndex]) +
        str_pad(bytes[++fieldIndex]);

    boot_data.FR =
        str_pad(bytes[++fieldIndex]) + "." +
        str_pad(bytes[++fieldIndex]) + "." +
        str_pad(bytes[++fieldIndex]);

    boot_data.HW =
        str_pad(bytes[++fieldIndex]) + "." +
        str_pad(bytes[++fieldIndex]) + "." +
        str_pad(bytes[++fieldIndex]);

    boot_data.TDCM =
        (bytes[++fieldIndex] << 8) |
         bytes[++fieldIndex];

    var timestamp =
        ((bytes[++fieldIndex] << 24) >>> 0) |
        (bytes[++fieldIndex] << 16) |
        (bytes[++fieldIndex] << 8)  |
         bytes[++fieldIndex];

    boot_data.Systimestamp = timestamp;

    boot_data.timestampUTC =
        new Date(timestamp * 1000).toISOString();

    return boot_data;
}

function decodeUplink(input)
{
    var b = input.bytes;

    if(b[0] === 0)
    {
        return {
            data: decodeBootMessage(b)
        };
    }

    var decoded = {};

    decoded.message_type = "Heartbeat";
    decoded.sensor_id = b[1];

    /*
        SUCCESS
    */
    if(b[2] === 0x00)
    {
        decoded.humidity_percent =
            ((b[3] << 8) | b[4]) / 10.0;

        var tempRaw =
            (b[5] << 8) | b[6];

        if(tempRaw > 32767)
        {
            tempRaw -= 65536;
        }

        decoded.temperature_c =
            tempRaw / 10.0;

        decoded.ec_us_cm =
            (b[7] << 8) | b[8];

        decoded.ph =
            ((b[9] << 8) | b[10]) / 100.0;

        decoded.nitrogen_mgkg =
            (b[11] << 8) | b[12];

        decoded.phosphorus_mgkg =
            (b[13] << 8) | b[14];

        decoded.potassium_mgkg =
            (b[15] << 8) | b[16];

        decoded.battery_percent = b[17];

        var timestamp =
            ((b[18] << 24) >>> 0) |
            (b[19] << 16) |
            (b[20] << 8)  |
             b[21];

        decoded.unix_timestamp = timestamp;

        decoded.timestampUTC =
            new Date(timestamp * 1000).toISOString();
    }
    /*
        ERROR
    */
    else
    {
        decoded.humidity_percent = "Error";
        decoded.temperature_c = "Error";
        decoded.ec_us_cm = "Error";
        decoded.ph = "Error";

        decoded.nitrogen_mgkg = "Error";
        decoded.phosphorus_mgkg = "Error";
        decoded.potassium_mgkg = "Error";

        decoded.battery_percent = b[3];

        var timestamp =
            ((b[4] << 24) >>> 0) |
            (b[5] << 16) |
            (b[6] << 8)  |
             b[7];

        decoded.unix_timestamp = timestamp;

        decoded.timestampUTC =
            new Date(timestamp * 1000).toISOString();
    }

    return {
        data: decoded
    };
}
