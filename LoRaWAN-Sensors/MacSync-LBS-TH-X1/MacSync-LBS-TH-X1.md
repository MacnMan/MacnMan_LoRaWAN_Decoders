# 📡 MacSync-LBS-TH-X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-LBS-TH-X1** is a LoRaWAN-enabled **Temperature & Humidity sensor** ( [SHT40](https://sensirion.com/products/catalog/SHT40) ). This folder provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

---

## 📂 Repository Structure

```
MacSync-LBS-TH-X1/
│
├── Decoder/
│   ├── MacSync-LBS-TH-X1_TTN.js         (decodeUplink / encodeDownlink)
│   ├── MacSync-LBS-TH-X1_Chirpstack.js  (ChirpStack v4)
│   ├── MacSync-LBS-TH-X1_Milesight.js   (v3 style: Decode / Encode)
│
├── Encoder/
│   └── MacSync-LBS-TH-X1_Encoder.js     (standalone downlink encoder)
│
└── MacSync-LBS-TH-X1.md
```

Each platform file in `Decoder/` is **complete** — it contains both the uplink decoder and the downlink encoder, so one paste per platform is enough.

---

## 🔓 Decoder (Uplink)

### ✅ Supported Platforms
- TTN (The Things Network) — `decodeUplink(input)`
- ChirpStack v4 — `decodeUplink(input)`
- Milesight Gateway (built-in NS) — `Decode(fPort, bytes)` / `Encode(fPort, obj)` — paste the whole file into both codec boxes

### 📦 Uplink Frame Types (by FPort)

| FPort | `type` | Content |
|-------|--------|---------|
| `2`   | `heartbeat` | temperature + humidity + battery + UTC |
| `3`   | `sampling` | 2–12 buffered samples + battery + UTC |
| `4`   | `trigger` | ALARM / CLEAR with value + min/max + battery + UTC |
| `5`   | `boot` | FW version (3B) + HW version (3B) + UTC (4B) |
| `16–21` | `config_ack` | Echo of the applied config downlink + battery |

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

### 📤 Output (Example — trigger alarm)
```json
{
  "type": "trigger",
  "deviceInfo": { "fPort": 4, "battery": 90, "unixUTC": 1757923200,
                  "timeUTC": "2025-09-15T08:00:00Z", "timeIST": "2025-09-15T13:30:00+05:30",
                  "trigNum": 1, "event": "ALARM" },
  "sensorInfo": { "param": "temperature", "value": 42.5, "min": 10, "max": 40 }
}
```

---

## 🔒 Encoder (Downlink)

JSON → bytes. **Put the port number in the JSON as `"port"` and set the same value as the downlink FPort** (the key `"fPort"` is also accepted). Every applied command is echoed back by the device as a `config_ack` uplink on the same port.

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
    "port": X
  }
}
```

---

## ⚙️ Downlink Commands

### 1. Transmission Interval — **FPort 16**
Heartbeat interval in **seconds** (60–86400).
```json
{ "port": 16, "interval": 600 }
```

**MQTT JSON Example**
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "port": 16,
    "interval": 600
  }
}
```

### 2. ADR On/Off — **FPort 17** (device reboots to apply)
```json
{ "port": 17, "adr": 1 }
```

### 3. Message Type — **FPort 18** (`0` = unconfirmed, `1` = confirmed)
```json
{ "port": 18, "msgtype": 1 }
```

### 4. Message Info — **FPort 19**
ADR + spreading factor (`sf` 7–12) + message type. Device reboots to apply.
```json
{ "port": 19, "adr": 0, "sf": 9, "msgtype": 1 }
```

### 5. Trigger Configuration — **FPort 20**
`trig` 1 or 2 · `param` `0` = temperature, `1` = humidity · `min`/`max` threshold window · `checktime` seconds · `enable` 0/1
```json
{ "port": 20, "trig": 1, "param": 0, "min": 10.00, "max": 40.00, "checktime": 60, "enable": 1 }
```

### 6. Sampling Configuration — **FPort 21**
`param` `0` = temperature, `1` = humidity, `2` = both · `count` 2–12 · `enable` 0/1
```json
{ "port": 21, "param": 2, "count": 6, "enable": 1 }
```
