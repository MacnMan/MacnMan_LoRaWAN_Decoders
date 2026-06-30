# 🅿️ ParkNode Gen-1 LoRaWAN Codec Documentation

## 📘 Overview
**ParkNode Gen-1** (firmware device ID: `ParkNode_LWAN_V1.0`) is a LoRaWAN-enabled **magnetic parking occupancy sensor** by **Macnman Technologies Pvt. Ltd.** It detects vehicle presence by sensing disturbances in the Earth's magnetic field using the ST **[IIS2MDC](https://www.st.com/en/mems-and-sensors/iis2mdc.html)** 3-axis digital magnetometer, and reports parking status (occupied / vacant) plus a tilt/tamper alert. This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

---

## 📂 Repository Structure

```
Other-Sensors/
└── ParkNode Gen-1/
    │
    ├── Decoder/
    │   ├── ParkNode_Gen1_Chirpstack.js
    │   ├── ParkNode_Gen1_Milesight.js
    │   ├── ParkNode_Gen1_TTN.js
    │
    ├── Encoder/
    │   ├── Encoder.js
    │
    └── ParkNode_Gen1.md
```

---

## 🧲 Sensing Principle
The IIS2MDC magnetometer continuously monitors the ambient magnetic field. A parked vehicle's ferrous mass distorts this field; the firmware compares live readings against a learned baseline to determine occupancy. The same sensor's tilt response is used to raise a **tamper alert** when the node is physically disturbed or removed.

| Parameter | Value |
|-----------|-------|
| Sensor | ST IIS2MDC (3-axis magnetometer) |
| Detection | Magnetic field disturbance vs. baseline |
| Status output | Occupied / Vacant |
| Alert output | Tilt / Tamper |

---

## 🔄 Codec Overview

| Type     | Direction | Purpose                          |
|----------|-----------|----------------------------------|
| Decoder  | Uplink    | Bytes → JSON (parking status)    |
| Encoder  | Downlink  | JSON → Bytes (device commands)   |

---

## 🔓 Decoder (Uplink)

Converts the raw LoRaWAN payload into readable JSON.

### ✅ Supported Platforms
- TTN (The Things Network)
- ChirpStack
- Milesight Gateway

### 📥 Input
- Raw payload (HEX / Base64 / bytes)

### 📦 Payload Formats

The decoder recognizes **two payload types**, distinguished by the first byte and the total length.

#### 1️⃣ Normal Parking Payload (8 bytes)

| Byte | Field          | Type     | Description                                   |
|------|----------------|----------|-----------------------------------------------|
| 0    | `devId`        | uint8    | Device ID                                     |
| 1    | `msgType`      | uint8    | `0x00` = event (status change), `0x01` = heartbeat |
| 2    | `parkStatus`   | uint8    | `0x01` = occupied (true), `0x00` = vacant (false) |
| 3    | `battery`      | uint8    | Battery level (%)                             |
| 4–7  | `Systimestamp` | uint32   | System timestamp (big-endian, seconds)        |

#### 2️⃣ Tilt / Tamper Alert Payload (6 bytes)

Triggered when `bytes[0] === 0x0F`.

| Byte | Field           | Type   | Description                          |
|------|-----------------|--------|--------------------------------------|
| 0    | `devId`         | uint8  | Fixed marker `0x0F` (tamper frame)   |
| 1    | `tamperStatus`  | uint8  | `0x01` = tampered (true), `0x00` = clear |
| 2–5  | `Systimestamp`  | uint32 | Event timestamp (big-endian, seconds) |

### 📤 Output Examples

**Normal heartbeat (vacant):**
```json
{
  "devId": 1,
  "msgType": "heartbeat",
  "parkStatus": false,
  "battery": 100,
  "Systimestamp": 1719772800,
  "length": 8,
  "oem": "MACNMAN",
  "device": "ParkNode_LWAN_V1.0",
  "version": "1.0",
  "sensorInfo": {}
}
```

**Status-change event (occupied):**
```json
{
  "devId": 1,
  "msgType": "event",
  "parkStatus": true,
  "battery": 98,
  "Systimestamp": 1719773100,
  "length": 8,
  "oem": "MACNMAN",
  "device": "ParkNode_LWAN_V1.0",
  "version": "1.0",
  "sensorInfo": {}
}
```

**Tamper alert:**
```json
{
  "devId": 15,
  "msgType": "tamper_alert",
  "tamperStatus": true,
  "Systimestamp": 1719773400,
  "length": 6,
  "oem": "MACNMAN",
  "device": "ParkNode_LWAN_V1.0",
  "version": "1.0"
}
```

---

## 🔒 Encoder (Downlink)

Converts JSON commands into an encoded payload for device configuration.

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
- Sets the heartbeat uplink interval in **seconds**
- Device applies the new interval immediately

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