# 📡 MacSync-LS7_X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-LS7_X1** is a LoRaWAN-enabled **7-in-1 Soil sensor** ( [JXCT 7 in 1 Integrated Soil Sensor](https://www.jxct-iot.com/product/showproduct.php?id=197) ) measuring soil moisture, temperature, EC, pH, nitrogen, phosphorus and potassium. This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

---

## 📂 Repository Structure

MacSync-LS7_X1/
│
├── Decoder/
│   ├── MacSync-LS7_X1_TTN.js
│   ├── MacSync-LS7_X1_Chirpstack.js
│   ├── MacSync-LS7_X1_Milesight.js
│
├── Encoder/
│   ├── MacSync-LS7_X1_TTN.js
│   ├── MacSync-LS7_X1_Milesight.js
│
└── MacSync-LS7_X1.md

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
- TTN (The Things Network)
- ChirpStack
- Milesight Gateway

### 📥 Input
- Raw payload (HEX/Base64 / bytes)

### 📤 Output (Example)
```json
{
  "message_type": "Heartbeat",
  "sensor_id": 1,
  "humidity_percent": 60.2,
  "temperature_c": 25.6,
  "ec_us_cm": 957,
  "ph": 7.0,
  "nitrogen_mgkg": 12,
  "phosphorus_mgkg": 8,
  "potassium_mgkg": 20,
  "battery_percent": 100,
  "unix_timestamp": 1757923200,
  "timestampUTC": "2025-09-15T08:00:00.000Z"
}
```

## 🔓 Encoder (Downlink)

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