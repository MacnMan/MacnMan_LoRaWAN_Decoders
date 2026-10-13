# Parking Occupancy Sensor - ParkNode Gen-1

ParkNode Gen-1 is a LoRaWAN® magnetic parking sensor. It reports whether the parking spot is occupied or vacant, and raises a tamper alert when the sensor is tilted or moved.

For more detailed information, please visit [Macnman Official Website](https://macnman.com/docs/category/lorawan)

## Codec

|      PLATFORM      | FILE                                                             | FUNCTIONS    |
| :----------------: | ---------------------------------------------------------------- | ------------ |
| The Things Network | [ParkNode_Gen1_TTN.js](Decoder/ParkNode_Gen1_TTN.js)             | decodeUplink |
|   ChirpStack v4    | [ParkNode_Gen1_Chirpstack.js](Decoder/ParkNode_Gen1_Chirpstack.js) | decodeUplink |
| Milesight Gateway  | [ParkNode_Gen1_Milesight.js](Decoder/ParkNode_Gen1_Milesight.js)   | Decode       |

This device has an uplink decoder only. The decoded values are returned inside a `Payload` object.

## Payload

```
+-------------------------------------------------------------+
|                    DEVICE UPLINK PAYLOAD                    |
+-----------+-------------------------------------+-----------+
|  DEVICE   |                DATA                 |   TIME    |
|  1 Byte   |             1 - 3 Bytes             |  4 Bytes  |
+-----------+-------------------------------------+-----------+
```

All uplinks are sent on FPort 2. The first byte tells the frame type: `0x10` is a parking frame, `0x0F` is a tamper alert. The time is big-endian (MSB first).

### Telemetry

|   CHANNEL    | FPORT | LENGTH | DESCRIPTION                                                                                                                                                                                                                                                                                  |
| :----------: | :---: | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   Parking    | 0x02  |   8    | devId(1B) + msgType(1B) + parkStatus(1B) + battery(1B) + time(4B)<br/>devId, value: 0x10<br/>msgType, values: (0: event, 1: heartbeat)<br/>parkStatus, values: (0: vacant, 1: occupied)<br/>battery, unit: %<br/>time, unit: s (Unix time, UTC)                                                |
| Tamper Alert | 0x02  |   6    | devId(1B) + tamperStatus(1B) + time(4B)<br/>devId, value: 0x0F<br/>tamperStatus, values: (1: tampered)<br/>time, unit: s (Unix time + 19800 s, i.e. Indian Standard Time)<br/>sent 3 times in a row when the sensor is tilted or moved                                                        |

- **event** is sent as soon as the parking state changes (vacant → occupied or occupied → vacant).
- **heartbeat** is sent at the heartbeat interval and repeats the current parking state. The first uplink after joining is a heartbeat with `parkStatus` vacant.
- Frames of any other length are not decoded by this codec, for example the 18-byte settings reply the device sends after an interval downlink.

### Decoded fields

|     FIELD      | DESCRIPTION                                                  |
| :------------: | ------------------------------------------------------------ |
|    `devId`     | first payload byte (16 = parking frame, 15 = tamper alert)   |
|   `msgType`    | `event`, `heartbeat` or `tamper_alert`                       |
|  `parkStatus`  | `true` = occupied, `false` = vacant                          |
| `tamperStatus` | `true` = tampered (tamper alert only)                        |
|   `battery`    | battery level in %                                           |
| `Systimestamp` | time of the frame in Unix seconds                            |
|    `length`    | payload length in bytes                                      |
|     `oem`      | `MACNMAN`                                                    |
|    `device`    | `ParkOMate_LWAN_V1.0`                                        |
|   `version`    | `1.0`                                                        |

## Example

### Uplink

```json
// FPort 2: 10 01 00 64 6ABCDDA0
{
    "Payload": {
        "devId": 16,
        "msgType": "heartbeat",
        "length": 8,
        "oem": "MACNMAN",
        "device": "ParkOMate_LWAN_V1.0",
        "version": "1.0",
        "sensorInfo": {},
        "parkStatus": false,
        "battery": 100,
        "Systimestamp": 1790762400
    }
}

// FPort 2: 10 00 01 62 6ABCDECC
{
    "Payload": {
        "devId": 16,
        "msgType": "event",
        "length": 8,
        "oem": "MACNMAN",
        "device": "ParkOMate_LWAN_V1.0",
        "version": "1.0",
        "sensorInfo": {},
        "parkStatus": true,
        "battery": 98,
        "Systimestamp": 1790762700
    }
}

// FPort 2: 0F 01 6ABD2D50
{
    "Payload": {
        "devId": 15,
        "msgType": "tamper_alert",
        "tamperStatus": true,
        "Systimestamp": 1790782800,
        "length": 6,
        "oem": "MACNMAN",
        "device": "ParkOMate_LWAN_V1.0",
        "version": "1.0"
    }
}
```
