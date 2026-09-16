# 📡 MacSet-LX2 LoRaWAN Codec Documentation

## 📘 Overview
**MacSet-LX2** is an industrial-grade **LoRaWAN® Multi-IO Controller** with **8 × 16 A relay outputs**, **8 configurable AI/DI channels** (digital input, 0–10 V, 4–20 mA) and **1 × RS485 Modbus RTU master** interface. It is designed for remote automation of pumps, motors, valves, alarms, contactors and industrial panels over LoRaWAN® (Class A / Class C).

See the [MacSet LX2 product page](https://macnman.com/docs/product/lorawan/controllers/macset-lx-two-datasheet) for the full datasheet.

---

## 🔄 Codec Overview

| Type     | Direction | Purpose                          |
|----------|-----------|----------------------------------|
| Decoder  | Uplink    | Bytes → JSON (IO / sensor state) |
| Encoder  | Downlink  | JSON → Bytes (relay & config commands) |

---

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

## 🔒 Downlink Commands

MacSet-LX2 shares the MacSet controller command set (see [MacSet-LX1](../MacSet-LX1/MacSet-LX1.md) for the common commands):

- **FPort 6** — transmission interval (`txTime`, seconds)
- **FPort 5** — relay control (relay outputs 1–8 on LX2)
- **FPort 10** — Modbus field configuration
- **FPort 9 / 8** — Modbus register / coil write
- **FPort 11** — alarm configurations (regular / cyclic / sensor-based trigger)
- **FPort 14 / 15** — read back alarm / Modbus configuration
- **FPort 12** — RS485 baud rate + parity

> 🚧 The LX2-specific codec files (8-relay control and AI/DI channel decoding) will be published in this folder. Until then, configure the device via the **Macnman Maya App** (BLE) or contact [Macnman support](https://macnman.com) for the interim codec.
