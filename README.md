# 📡 MacnMan LoRaWAN Decoders

JavaScript payload **decoders** (uplink: bytes → JSON) and **encoders** (downlink: JSON → bytes) for **Macnman LoRaWAN® devices**, compatible with **TTN (The Things Network)**, **ChirpStack**, and **Milesight gateways** (built-in network server).

📚 Product documentation & datasheets: [macnman.com/docs](https://macnman.com/docs/category/lorawan)

---

## 📂 Device Index

### LoRaWAN Dataloggers (MacSync LX1 family)
| Device | Description | Codec |
|--------|-------------|-------|
| [MacSync-LBO-X1](LoRaWAN-Dataloggers/MacSync-LBO-X1) | RS485 (Modbus RTU) / Analog datalogger — battery operated | Decoder + Encoder |
| [MacSync-LPO-X1](LoRaWAN-Dataloggers/MacSync-LPO-X1) | RS485 (Modbus RTU) / Analog datalogger — line powered (9–36 V DC) | Decoder + Encoder |
| [MacSync-LSO-X1](LoRaWAN-Dataloggers/MacSync-LSO-X1) | RS485 (Modbus RTU) / Analog datalogger — solar powered | Decoder + Encoder |

### LoRaWAN Controllers (MacSet)
| Device | Description | Codec |
|--------|-------------|-------|
| [MacSet-LX1](LoRaWAN-Controllers/MacSet-LX1) | 2-relay controller with RS485 | Downlink command docs |
| [MacSet-LX2](LoRaWAN-Controllers/MacSet-LX2) | 8 × 16 A relay Multi-IO controller with RS485 + 8 AI/DI | Downlink command docs |

### LoRaWAN Sensors
| Device | Description | Codec |
|--------|-------------|-------|
| [MacSync-LT_X1](LoRaWAN-Sensors/Temperature%26Humidity-Sensors/MacSync-LT_X1) | Temperature & humidity (SHT40) | Decoder + Encoder |
| [MacSync-LTH_BS_X1](LoRaWAN-Sensors/Temperature%26Humidity-Sensors/MacSync-LTH_BS_X1) | Temperature & humidity (SHT40) | Decoder + Encoder |
| [MacSync-LS2_X1](LoRaWAN-Sensors/Soil-Sensors/MacSync-LS2_X1) | 2-in-1 soil moisture & temperature | Decoder + Encoder |
| [MacSync-LS7_X1](LoRaWAN-Sensors/Soil-Sensors/MacSync-LS7_X1) | 7-in-1 soil sensor (moisture, temp, EC, pH, N, P, K) | Decoder + Encoder |
| [MacSync-LPS28](LoRaWAN-Sensors/Pressure-Sensors/MacSync-LPS28) | Pressure / hydrostatic level (LPS28DFW) | Decoder + Encoder |
| [MacSync-L-Odor_X1](LoRaWAN-Sensors/Gas-Sensors/MacSync-L-Odor_X1) | Odour monitoring — NH₃ / H₂S | Decoder + Encoder |
| [ParkNode Gen-1](LoRaWAN-Sensors/Other-Sensors) | Magnetic parking occupancy sensor | Decoder + Encoder |

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

- **Uplink JSON** contains `deviceInfo` (battery, UTC + IST timestamps, fPort) and `sensorInfo` (readings) for the newer MacSync-L family, or a flat object for the older device families.
- **Downlink JSON** always carries the target `fPort` — see each device's `.md` for the full command table.
- Timestamps are Unix UTC seconds, big-endian on the wire.

---

## 🏢 Macnman Technologies Pvt. Ltd.

[macnman.com](https://www.macnman.com) · [Product documentation](https://macnman.com/docs)
