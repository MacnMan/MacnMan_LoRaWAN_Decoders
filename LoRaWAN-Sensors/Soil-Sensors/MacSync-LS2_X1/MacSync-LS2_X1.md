# 📡 MacSync-LS2_X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-LS2_X1** is a LoRaWAN-enabled **2-in-1 Soil Moisture & Temperature sensor** ( [JXCT integrated soil sensor](https://www.jxct-iot.com/) ) device. This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

---

## 📂 Repository Structure

```
MacSync-LS2_X1/
│
├── Decoder/
│   ├── MacSync-LS2_X1_TTN.js
│   ├── MacSync-LS2_X1_Chirpstack.js
│   ├── MacSync-LS2_X1_Milesight.js
│
├── Encoder/
│   ├── MacSync-LS2_X1_TTN.js
│   ├── MacSync-LS2_X1_Milesight.js
│
└── MacSync-LS2_X1.md
```

---

## 🔄 Codec Overview

| Type     | Direction | Purpose                          |
|----------|----------|----------------------------------|
| Decoder  | Uplink   | Bytes → JSON (sensor data)       |
| Encoder  | Downlink | JSON → Bytes (device commands)   |

---

## 🔓 Decoder (Uplink)

Converts raw LoRaWAN payload into readable JSON.

### ✅ Supported Platforms
- TTN (The Things Network) — `decodeUplink(input)`
- ChirpStack — `decodeUplink(input)`
- Milesight Gateway — `Decode(fPort, bytes)`

### 📦 Payload Formats

**Boot message** — first byte `0x00`: OEM ID, firmware & hardware version, TX interval, timestamp.

**Heartbeat** — first byte `0x01`:

| Byte  | Field | Description |
|-------|-------|-------------|
| 0     | uplink type | `0x01` = data |
| 1     | sensor id | device sensor identifier |
| 2     | status | `0x00` = OK, else sensor read error |
| 3–4   | moisture ×10 | u16, %RH of soil (volumetric) |
| 5–6   | temperature ×10 | s16, °C |
| 7     | battery | % |
| 8–11  | timestamp | u32 UTC seconds (big-endian) |

### 📤 Output (Example)
```json
{
  "message_type": "Heartbeat",
  "sensor_id": 1,
  "humidity_percent": 60.2,
  "temperature_c": 25.6,
  "battery_percent": 100,
  "unix_timestamp": 1757923200,
  "timestampUTC": "2025-09-15T08:00:00.000Z"
}
```

## 🔒 Encoder (Downlink)

Converts JSON commands into encoded payload for device configuration.


## 📌 MQTT Downlink Basics (ChirpStack v4)

### Topic Format
```
application/{applicationId}/device/{devEui}/command/down
```

### Generic MQTT Payload Structure
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "...": "payload fields",
    "fPort": X
  }
}
```

---

## 1. Change Transmission Interval
**FPort:** `06`

### Description
- Sets uplink transmission interval in **seconds**
- Device applies new interval immediately

### ChirpStack Object JSON
```json
{
  "txTime": 600,
  "fPort": 6
}
```

### MQTT JSON Example
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "txTime": 600,
    "fPort": 6
  }
}
```
