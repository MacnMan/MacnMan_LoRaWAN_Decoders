# MacnMan LoRaWAN Decoders

Sample functions for Macnman LoRaWAN® device decoders (uplink: bytes → JSON) and encoders (downlink: JSON → bytes).

Product documentation and datasheets: [macnman.com/docs](https://macnman.com/docs/category/lorawan)

## Devices

|              DEVICE              |     MODEL     | FOLDER                                                                           |
| :------------------------------: | :-----------: | -------------------------------------------------------------------------------- |
| RS485 & Analog to LoRaWAN Sensor | MS_LBS_STD_X1 | [LoRaWAN-Sensors/MacSync_LBS_STD_X1_RS485](LoRaWAN-Sensors/MacSync_LBS_STD_X1_RS485) |
|  Temperature & Humidity Sensor   | MS_LBS_TH_X1  | [LoRaWAN-Sensors/MacSync-LBS-TH-X1](LoRaWAN-Sensors/MacSync-LBS-TH-X1)               |

Open a device folder to see its payload format, downlink commands and examples.

## Folder Layout

```
<Device>/
├── README.md         payload format, downlink commands, examples
├── <Device>.png      product picture
├── Decoder/          complete codec (uplink decoder + downlink encoder), one file per platform
│   ├── <Device>_TTN.js
│   ├── <Device>_Chirpstack.js
│   └── <Device>_Milesight.js
└── Encoder/          standalone downlink encoder
    └── <Device>_Encoder.js
```

## The following platforms are supported

- [The Things Network](https://www.thethingsnetwork.org)
- [ChirpStack v4](https://www.chirpstack.io)
- [Milesight Gateway](https://www.milesight.com/iot/#lorawan-gateway) (built-in network server)

## How to Use

### The Things Stack

1. *Applications → your app → Payload formatters → Uplink*.
2. Select **Custom Javascript formatter** and paste the whole `_TTN.js` file.
3. Paste the same file into the *Downlink* formatter (it contains `encodeDownlink`).

### ChirpStack v4

1. *Device profile → Codec → JavaScript functions*.
2. Paste the whole `_Chirpstack.js` file.
3. Send a downlink over MQTT. Put the FPort both in `fPort` and in the object as `"port"`:

Topic:

```
application/{applicationId}/device/{devEui}/command/down
```

Payload:

```json
{
    "devEui": "0080e11505ca2663",
    "confirmed": true,
    "fPort": 16,
    "object": { "port": 16, "interval": 600 }
}
```

### Milesight Gateway (UG63 / UG65 / UG67)

1. *Network Server → Profiles → device profile → Payload Codec → Custom*.
2. Paste the whole `_Milesight.js` file into **both** the decoder box and the encoder box.

## Codec Conventions

- **Uplink JSON** contains `type` (heartbeat / sampling / trigger / boot / config_ack / …), `deviceInfo` (battery, UTC + IST time, fPort) and `sensorInfo` (readings).
- **Downlink JSON** carries the target FPort as `"port"` (the key `"fPort"` also works). Every applied command is echoed back by the device on the same FPort.
- All multi-byte values are big-endian. Times are Unix seconds, UTC.

## Macnman Technologies Pvt. Ltd.

[macnman.com](https://www.macnman.com) · [Product documentation](https://macnman.com/docs)
