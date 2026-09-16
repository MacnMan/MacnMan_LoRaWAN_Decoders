# 📡 MacSync_LBS_TH_X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync_LBS_TH_X1** is a LoRaWAN-enabled **Temeperature & Humidity sensor** ( [SHT40](https://sensirion.com/products/catalog/SHT40) ) device. This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

---

## 📂 Repository Structure

MacSync_LBS_TH_X1/
│
├── Decoder/
│   ├── MacSync_LBS_TH_X1_TTN.js
│   ├── MacSync_LBS_TH_X1_Chirpstack.js
│   ├── MacSync_LBS_TH_X1_Milesight.js
│
├── Encoder/
│   ├── MacSync_LBS_TH_X1_Encoder.js
│
└── MacSync_LBS_TH_X1.md

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
  "temperature": 25.6,
  "humidity": 60.2,
  "battery": 100
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

Every applied config is echoed back by the device as a `config_ack` uplink on the same port.

## 1. Change Transmission Interval
**FPort:** `16` — heartbeat interval in **seconds** (60–86400), unsigned 32-bit.

```json
{ "interval": 600, "fPort": 16 }
```

### MQTT JSON Example
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "interval": 600,
    "fPort": 16
  }
}
```

## 2. ADR On/Off
**FPort:** `17` — device reboots to apply.

```json
{ "adr": 1, "fPort": 17 }
```

## 3. Message Type
**FPort:** `18` — `0` = unconfirmed, `1` = confirmed.

```json
{ "msgtype": 1, "fPort": 18 }
```

## 4. Message Info (ADR + SF + Message Type)
**FPort:** `19` — `sf` is the spreading factor 7–12 (sent raw; firmware converts to DR). Device reboots to apply.

```json
{ "adr": 0, "sf": 9, "msgtype": 1, "fPort": 19 }
```

## 5. Trigger Configuration
**FPort:** `20`
- `trig`: 1 or 2 · `param`: `0` = temperature, `1` = humidity
- `min` / `max`: threshold window (2 decimals) · `checktime`: seconds · `enable`: 0/1

```json
{ "trig": 1, "param": 0, "min": 10.00, "max": 40.00, "checktime": 60, "enable": 1, "fPort": 20 }
```

## 6. Sampling Configuration
**FPort:** `21` — `param`: `0` = temperature, `1` = humidity, `2` = both · `count`: 2–12 · `enable`: 0/1

```json
{ "param": 2, "count": 6, "enable": 1, "fPort": 21 }
```