# 📡 MacSync-LT_X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-LT_X1** is a LoRaWAN-enabled **Temperature & Humidity sensor** ( [SHT40](https://sensirion.com/products/catalog/SHT40) ) device. This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

> ℹ️ MacSync-LT_X1 runs the shared **MacSync-L SHT40 firmware** — the codec is the same as MacSync-LTH_BS_x1.

---

## 📂 Repository Structure

```
MacSync-LT_X1/
│
├── Decoder/
│   ├── MacSync-LT_X1_TTN.js
│   ├── MacSync-LT_X1_Chirpstack.js
│   ├── MacSync-LT_X1_Milesight.js
│
├── Encoder/
│   ├── MacSync-LT_X1_TTN.js          (also works on ChirpStack v4)
│   ├── MacSync-LT_X1_Milesight.js    (ChirpStack v3-style Decode/Encode)
│
└── MacSync-LT_X1.md
```

---

## 🔄 Codec Overview

| Type     | Direction | Purpose                          |
|----------|----------|----------------------------------|
| Decoder  | Uplink   | Bytes → JSON (sensor data)       |
| Encoder  | Downlink | JSON → Bytes (device commands)   |

---

## 🔓 Decoder (Uplink)

### ✅ Supported Platforms
- TTN (The Things Network) — `decodeUplink(input)`
- ChirpStack v4 — `decodeUplink(input)`
- Milesight Gateway (built-in NS, ChirpStack v3 style) — `Decode(fPort, bytes)`

### 📦 Uplink Frame Types (by FPort)

| FPort | Frame | Content |
|-------|-------|---------|
| `5`   | Boot | FW version (3B) + HW version (3B) + UTC (4B) |
| `2`   | Heartbeat | temperature ×100 (s16) + humidity ×100 (s16) + battery + UTC |
| `3`   | Sampling batch | 2–12 buffered samples + battery + UTC |
| `4`   | Trigger | ALARM / CLEAR with value + min/max + battery + UTC |
| `16–21` | Config ACK | Echo of the applied config downlink + battery |

### 📤 Output (Example — heartbeat)
```json
{
  "type": "heartbeat",
  "deviceInfo": {
    "fPort": 2,
    "battery": 98,
    "unixUTC": 1757923200,
    "timeUTC": "2025-09-15T08:00:00Z",
    "timeIST": "2025-09-15T13:30:00+05:30"
  },
  "sensorInfo": {
    "temperature": 25.6,
    "humidity": 60.2
  }
}
```

---

## 🔒 Encoder (Downlink)

Converts JSON commands into an encoded payload. Every applied config is echoed back by the device as a `config_ack` uplink on the same port.

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
**FPort:** `16` — heartbeat interval in **seconds** (60–86400), unsigned 32-bit.

```json
{ "interval": 600, "fPort": 16 }
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
