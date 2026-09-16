# 📡 MacSync-LPO-X1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-LPO-X1** is a line-powered (9–36 V DC) **RS485 (Modbus RTU) & Analog to LoRaWAN® Datalogger** from the MacSync LX1 datalogger family. It wirelessly connects Modbus RTU devices (energy meters, PLCs, flow meters, transmitters) and analog instruments (4–20 mA / 0–10 V / digital inputs) to LoRaWAN® networks. See the [product page](https://macnman.com/docs/product/lorawan/dataloggers/rs485-analog-to-lorawan-converter-macsync-lx1) for hardware details.

This folder provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

> ℹ️ All MacSync LX1 datalogger variants (LBO / LPO / LSO) run the same firmware payload format — the codecs are identical across variants.

---

## 📂 Repository Structure

```
MacSync-LPO-X1/
│
├── Decoder/
│   ├── MacSync-LPO-X1_TTN.js
│   ├── MacSync-LPO-X1_Chirpstack.js
│   ├── MacSync-LPO-X1_Milesight.js
│
├── Encoder/
│   ├── MacSync-LPO-X1_Encoder.js
│
└── MacSync-LPO_X1.md
```

---

## 🔄 Codec Overview

| Type     | Direction | Purpose                          |
|----------|-----------|----------------------------------|
| Decoder  | Uplink    | Bytes → JSON (sensor data)       |
| Encoder  | Downlink  | JSON → Bytes (device commands)   |

---

## 🔓 Decoder (Uplink)

### ✅ Supported Platforms
- TTN (The Things Network) — `decodeUplink(input)`
- ChirpStack v4 — `decodeUplink(input)`
- Milesight Gateway (built-in NS) — `Decode(fPort, bytes)`

### 📦 Uplink Frame Types (by FPort)

| FPort | Frame | Content |
|-------|-------|---------|
| `5`   | Boot | FW version (3B) + HW version (3B) + UTC (4B) |
| `2`   | Sensor data | RS485 field sweep **or** analog channels + battery + UTC |
| `3`   | Sampling batch | 2–12 buffered float32 samples + battery + UTC |
| `4`   | Trigger | ALARM / CLEAR event with value + min/max + battery + UTC |
| `16–21` | Config ACK | Echo of the applied config downlink + battery |
| `8/9/10/12/13/15` | Modbus reply | Response to a Modbus command downlink + UTC |

#### FPort 2 — RS485 sensor data
`[0]=1` (uplink type), `[1]=0` (source RS485), then **one tag byte per configured field (1–20)**:

- Tag byte = `(dataType << 5) | count`
  - `count = 0` → status marker: dataType `6` = field disabled, `7` = read error
  - otherwise `count` values follow (2 bytes each for 16-bit types, 4 bytes for 32-bit types)
- Data types: `0` int16 · `1` uint16 · `2` int32 · `3` int32 (word-swapped) · `4` float32 · `5` float32 (word-swapped) · `6` uint32 (word-swapped) · `7` uint32

Trailer: battery % (1B) + UTC seconds (4B, big-endian).

#### FPort 2 — Analog sensor data
`[0]=1`, `[1]=1` (source analog), then per channel (1–2): mode byte (`1` = 4-20 mA, `2` = 0-10 V, `3` = digital) + signed 16-bit value ×1000, or a single `0x00` if the channel is off. Trailer: battery + UTC.

### 📤 Output (Example — analog heartbeat)
```json
{
  "type": "heartbeat",
  "source": "analog",
  "deviceInfo": {
    "fPort": 2,
    "battery": 98,
    "unixUTC": 1757923200,
    "timeUTC": "2025-09-15T08:00:00Z",
    "timeIST": "2025-09-15T13:30:00+05:30"
  },
  "sensorInfo": {
    "channel1": { "mode": "4-20mA", "value_mA": 12.45 },
    "channel2": { "mode": "off" }
  }
}
```

### 📤 Output (Example — RS485 heartbeat)
```json
{
  "type": "heartbeat",
  "source": "rs485",
  "deviceInfo": { "fPort": 2, "battery": 97, "unixUTC": 1757923200 },
  "sensorInfo": {
    "fields": [
      { "field": 1, "dataType": "float32", "values": [230.4] },
      { "field": 2, "dataType": "uint16", "values": [4998] },
      { "field": 3, "status": "disabled" }
    ]
  }
}
```

---

## 🔒 Encoder (Downlink)

Converts JSON commands into an encoded payload for device configuration. Every applied config is echoed back by the device as an uplink on the same port.

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
**FPort:** `16`
- Heartbeat uplink interval in **seconds** (60–86400), unsigned 32-bit.

```json
{ "interval": 600, "fPort": 16 }
```

## 2. ADR On/Off
**FPort:** `17` — device reboots to apply.

```json
{ "adr": 1, "fPort": 17 }
```

## 3. Message Type
**FPort:** `18` — `0` = unconfirmed, `1` = confirmed uplinks.

```json
{ "msgtype": 1, "fPort": 18 }
```

## 4. Message Info (ADR + SF + Message Type)
**FPort:** `19` — `sf` is the LoRa spreading factor 7–12 (sent raw; firmware converts to DR). Device reboots to apply.

```json
{ "adr": 0, "sf": 9, "msgtype": 1, "fPort": 19 }
```

## 5. Trigger Configuration
**FPort:** `20`
- `trig`: trigger number 1 or 2
- `param`: `0` = Field/Channel 1, `1` = Field/Channel 2
- `min` / `max`: threshold window (2 decimals)
- `checktime`: check period in seconds (30–86400)
- `enable`: `1` = on, `0` = off

```json
{ "trig": 1, "param": 0, "min": 4.00, "max": 18.50, "checktime": 60, "enable": 1, "fPort": 20 }
```

## 6. Sampling Configuration
**FPort:** `21`
- `param`: `0` = Field/Ch 1, `1` = Field/Ch 2, `2` = both
- `count`: samples per batch (2–12)
- `enable`: `1` = on, `0` = off
- `interval` *(optional)*: per-sample interval in seconds (30–3600)

```json
{ "param": 2, "count": 6, "enable": 1, "interval": 60, "fPort": 21 }
```

## 7. Modbus Field Configuration
**FPort:** `10` — configures one of the 20 polled register entries.

**Data Type Mapping:** `0` INT16 · `1` UINT16 · `2` INT32 [MSB] · `3` INT32 [LSB] · `4` FLOAT32 [MSB] · `5` FLOAT32 [LSB] · `6` UINT32 [LSB] · `7` UINT32 [MSB]

```json
{
  "Field": 1,
  "slaveId": 2,
  "functionCode": 3,
  "Enable": 1,
  "dataType": 4,
  "numberOfParameters": 2,
  "Registeraddress": 3036,
  "fPort": 10
}
```

## 8. Read Back a Stored Field Configuration
**FPort:** `15`

```json
{ "index": 1, "fPort": 15 }
```

## 9. Live Modbus Register Read
**FPort:** `13` — performs an immediate Modbus read and uplinks the values on port 13.

```json
{
  "slaveId": 2,
  "functionCode": 3,
  "dataType": 4,
  "numberOfParameters": 1,
  "Registeraddress": 3036,
  "fPort": 13
}
```

## 10. Writing Modbus Registers / Coils
**FPort:** `9` for holding registers (FC06/FC16), **FPort:** `8` for coils (FC05/FC15).

```json
{ "slaveId": 4, "numberofreg": 1, "address": 0, "value": 255, "fPort": 9 }
```
```json
{ "slaveId": 10, "numberofreg": 1, "address": 0, "value": 65280, "fPort": 8 }
```

## 11. Configuring RS485 Baud Rate
**FPort:** `12` — baud 1200–115200; parity `0` none, `1` odd, `2` even.

```json
{ "baud": 9600, "parity": 1, "fPort": 12 }
```
