# 📡 MacSet-LX1 LoRaWAN Codec Documentation

## 🔓 Encoder (Downlink)

Converts JSON commands into encoded payload for device configuration.

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

---

## 2. Relay Control  
**FPort:** `05`

### Description
- `relay1`, `relay2`
- `1` = ON, `0` = OFF
- In **three-phase**, `relay1` controls all phases

### ChirpStack Object JSON Examples

**Relay1 ON**
```json
{
  "relay1": 1,
  "fPort": 5
}
```

**Relay2 OFF**
```json
{
  "relay2": 0,
  "fPort": 5
}
```

**Both Relays ON**
```json
{
  "relay1": 1,
  "relay2": 1,
  "fPort": 5
}
```

### MQTT JSON Example
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "relay1": 0,
    "relay2": 0,
    "fPort": 5
  }
}
```



## 3. Reading RS485 Data (FPort: 10)
This payload is used for reading RS485 data from a Modbus device.

### **Data Type Mapping:**
- `00`: INT16
- `01`: UINT16
- `02`: INT32 [MSB]
- `03`: INT32 [LSB]
- `04`: FLOAT32 [MSB]
- `05`: FLOAT32 [LSB]

**Example Chirpstack JSON :**
```json
{
  "Field": 1,
  "slaveId": 2,
  "functionCode": 3,
  "Enable": 1,
  "dataType": 2,
  "numberOfParameters": 2,
  "Registeraddress": 3036,
  "fPort": 10
}
```

  **Examples for MQTT JSON :**

  ```json
  {
    "devEui": "0080e11505ca2663",                
    "confirmed": true,                                
    "object": {
        "Field": 1,
        "slaveId": 2,
        "functionCode": 3,
        "Enable": 1,
        "dataType": 2,
        "numberOfParameters": 2,
        "Registeraddress": 3036,
        "fPort": 10
    }
  }
  ```
  ---

---

## 4. Writing Modbus Registers (FPort: 9 for Registers, FPort: 8 for Coils)
To write to a Modbus register, specify the slave ID, register address, and value.

**Examples:**
- **Writing to a register (FPort: 9)::**
  ```json
  {
      "slaveId": 4,
      "numberofreg": 1,
      "address": 0,
      "value": 255,
      "fPort":9
  }
  ```
- **Writing to a coil (FPort: 8):**
  ```json
  {
      "slaveId": 10,
      "numberofreg": 1,
      "address": 0,
      "value": 65280,
      "fPort":8
  }
  ```

---

## 5. Alarm Configurations (FPort: 11)
### 5.1 Regular Alarm
```json
{
    "index": 1,
    "startTime": 3600,
    "stopTime": 7200,
    "dayData": 127,
    "relayStatus": 1,
    "alarmType": 1,
    "enable": 1,
    "fPort":11
}
```

### 5.2 Cyclic Alarm
```json
{
    "index": 2,
    "startTime": 3600,
    "stopTime": 7200,
    "dayData": 127,
    "relayStatus": 1,
    "alarmType": 2,
    "enable": 1,
    "onTime": 60,
    "offTime": 120,
    "fPort":11
}
```

### 5.3 Sensor-Based Trigger Alarm
```json
{
    "index": 3,
    "startTime": 3600,
    "stopTime": 7200,
    "dayData": 127,
    "relayStatus": 1,
    "alarmType": 3,
    "enable": 1,
    "sensorValue": 85,
    "level": 2,
    "rs485Field": 1,
    "fPort":11
}
```

### 5.4 Reading an Alarm Configuration (FPort: 14)
```json
{
    "index": 1,
    "fPort":14
}
```

### 5.4 Reading an Modbus Configuration (FPort: 15)
```json
{
    "index": 1,
    "fPort":15
}
```

---

## 6. Configuring RS485 RTU Baud Rate (FPort: 12)
Baud rate and parity settings for RS485 RTU serial communication.
- **Parity Options:**
  - `0`: None
  - `1`: Odd
  - `2`: Even

**Example:**
```json
{
    "baud": 9600,
    "pairity": 1,
    "fPort":12
}
```