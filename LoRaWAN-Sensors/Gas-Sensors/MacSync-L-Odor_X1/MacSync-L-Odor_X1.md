# 📡 MacSync-L-Odor_X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-L-Odor_X1** is a LoRaWAN-enabled odour monitoring sensor designed for measuring odour-related gas concentrations, including **H₂S** and **NH₃**, using the **GM802B** and **GM602B** sensor modules. See the product references: [GM602B](https://www.winsen-sensor.com/product/gm-602b.html) and [GM802B](https://www.winsen-sensor.com/product/gm-802b.html). This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) support for TTN, ChirpStack, and Milesight LNS integrations.

---

## 📂 Repository Structure

MacSync L Odor X1/
│
├── Decoder/
│   └── MacSync-L-Odor_X1.js
│
├── Encoder/
└── MacSync-L-Odor_X1.md

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
  "h2s": 0.8,
  "nh3": 2.4,
  "battery": 100
}
```

> Note: The sample `h2s` and `nh3` values above are shown in percentage (%) units.

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