# 📡 MacnMan LoRaWAN Decoders

JavaScript payload **decoders** (uplink: bytes → JSON) and **encoders** (downlink: JSON → bytes) for **Macnman LoRaWAN® devices**, compatible with **TTN (The Things Network)**, **ChirpStack**, and **Milesight gateways** (built-in network server).

📚 Product documentation & datasheets: [macnman.com/docs](https://macnman.com/docs/category/lorawan)

---

## 📂 Device Index

| Device | Description | Codec |
|--------|-------------|-------|
| [MacSync_LBD_STD_X1_RS485](LoRaWAN-Dataloggers/MacSync_LBD_STD_X1_RS485) | RS485 (Modbus RTU) & Analog to LoRaWAN® datalogger (MacSync LX1 family) | Decoder + Encoder |
| [MacSync_LBS_TH_X1](LoRaWAN-Sensors/MacSync_LBS_TH_X1) | Temperature & humidity sensor (SHT40) | Decoder + Encoder |

---

## 🚀 How to Use

Each device folder contains:

```
<Device>/
├── Decoder/          uplink codec, one file per platform
│   ├── <Device>_TTN.js
│   ├── <Device>_Chirpstack.js
│   └── <Device>_Milesight.js
├── Encoder/          downlink codec
│   └── <Device>_Encoder.js
└── <Device>.md       payload format + downlink command reference
```

### TTN (The Things Stack)
1. Console → *Applications → your app → Payload formatters → Uplink*.
2. Select **Custom Javascript formatter** and paste the `_TTN.js` decoder.
3. For downlinks, paste the Encoder file into the *Downlink* formatter.

### ChirpStack v4
1. *Device profile → Codec → JavaScript functions*.
2. Paste the `_Chirpstack.js` decoder (and the Encoder file below it — `decodeUplink` / `encodeDownlink` live side by side).
3. Queue downlinks via MQTT on `application/{applicationId}/device/{devEui}/command/down` — see each device's `.md` for the JSON commands.

### Milesight Gateway (UG63 / UG65 / UG67, built-in NS)
1. *Network Server → Profiles → device profile → Payload Codec → Custom*.
2. Paste the `_Milesight.js` file into the decoder (and encoder) box.

---

## 🔄 Codec Conventions

- **Uplink JSON** contains `deviceInfo` (battery, UTC + IST timestamps, fPort) and `sensorInfo` (readings).
- **Downlink JSON** always carries the target `fPort` — see each device's `.md` for the full command table. Every applied config is echoed back by the device on the same port.
- Timestamps are Unix UTC seconds, big-endian on the wire.

---

## 🏢 Macnman Technologies Pvt. Ltd.

[macnman.com](https://www.macnman.com) · [Product documentation](https://macnman.com/docs)
