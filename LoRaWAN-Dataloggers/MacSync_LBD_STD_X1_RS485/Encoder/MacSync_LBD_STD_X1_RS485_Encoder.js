// ===================================================================
// MacSync_LBD_STD_X1_RS485 — RS485 (Modbus RTU) / Analog to LoRaWAN Datalogger
// DOWNLINK ENCODER — JSON -> bytes. Enqueue with matching fPort + "port".
//   Macnman Technologies Pvt. Ltd.
//
//   16 TXinterval, 17 ADR, 18 MsgType, 19 MSGINFO(adr+sf+msgtype),
//   20 TrigCfg(+enable), 21 SampCfg(+enable, optional interval)
//   10 Modbus field config, 15 field read-back, 13 live register read,
//    9 holding-register write, 8 coil write, 12 Modbus baud + parity
//
//   MSGINFO takes "sf" 7..12, sent RAW on the wire. The firmware converts
//   SF<->DR (downlink path only); the codec does no rate math.
//   The device echoes every applied config back as an uplink on the same
//   port (see the Decoder's "config_ack" / "modbus_reply" frames).
// ===================================================================
function encodeDownlink(input) {
  var d = input.data;
  // ChirpStack may not pass input.fPort into encodeDownlink reliably,
  // so accept a "port"/"fPort" field in the JSON as the primary source.
  var fport = (d && d.port !== undefined) ? d.port :
              (d && d.fPort !== undefined) ? d.fPort : input.fPort;
  var bytes = [];

  switch (fport) {
    case 16: // TX interval (seconds, 60..86400) — u32
      var s = d.interval >>> 0;
      bytes = [(s>>24)&0xFF, (s>>16)&0xFF, (s>>8)&0xFF, s&0xFF];
      break;

    case 17: // ADR (0/1) — device reboots to apply
      bytes = [d.adr & 0x01];
      break;

    case 18: // Msg type (0=unconf, 1=conf)
      bytes = [d.msgtype & 0x01];
      break;

    case 19: // MSGINFO: adr, SF(7..12), msgtype  (SF raw; firmware -> DR)
      var sfv;
      if (d.sf !== undefined) {
        sfv = d.sf & 0xFF;
      } else {
        sfv = 12 - (d.dr & 0xFF);            // fallback if caller sends dr
      }
      if (sfv < 7)  sfv = 7;
      if (sfv > 12) sfv = 12;
      bytes = [d.adr & 0x01, sfv & 0xFF, d.msgtype & 0x01];
      break;

    case 20: // Trigger config: trig, param(0=F/Ch1, 1=F/Ch2),
             //                 min, max (x100), checktime s, enable
      var mn = Math.round(d.min * 100);
      var mx = Math.round(d.max * 100);
      var ct = d.checktime >>> 0;
      bytes = [
        d.trig & 0xFF, d.param & 0xFF,
        (mn>>8)&0xFF, mn&0xFF,
        (mx>>8)&0xFF, mx&0xFF,
        (ct>>8)&0xFF, ct&0xFF,
        d.enable & 0x01
      ];
      break;

    case 21: // Sampling config: param(0/1/2=both), count(2..12), enable
             // + optional per-sample interval (seconds, 30..3600)
      bytes = [d.param & 0xFF, d.count & 0xFF, d.enable & 0x01];
      if (d.interval !== undefined) {
        var iv = d.interval >>> 0;
        bytes.push((iv>>8)&0xFF, iv&0xFF);
      }
      break;

    case 10: // Modbus field config (field 1..20)
      var ra10 = d.Registeraddress >>> 0;
      bytes = [
        d.Field & 0xFF,
        d.slaveId & 0xFF,
        d.functionCode & 0xFF,
        d.Enable & 0x01,
        d.dataType & 0xFF,
        d.numberOfParameters & 0xFF,
        (ra10>>8)&0xFF, ra10&0xFF
      ];
      break;

    case 15: // Read back a stored field config
      bytes = [d.index & 0xFF];
      break;

    case 13: // Live register read
      var ra13 = d.Registeraddress >>> 0;
      bytes = [
        d.slaveId & 0xFF,
        d.functionCode & 0xFF,
        d.dataType & 0xFF,
        d.numberOfParameters & 0xFF,
        (ra13>>8)&0xFF, ra13&0xFF
      ];
      break;

    case 9:  // Holding-register write (FC06 / FC16)
    case 8:  // Coil write (FC05 / FC15)
      var adr = d.address >>> 0;
      var nreg = d.numberofreg & 0xFF;
      bytes = [d.slaveId & 0xFF, nreg, (adr>>8)&0xFF, adr&0xFF];
      var val = d.value | 0;
      if (nreg === 1) {
        bytes.push((val>>8)&0xFF, val&0xFF);
      } else {
        bytes.push((val>>24)&0xFF, (val>>16)&0xFF, (val>>8)&0xFF, val&0xFF);
      }
      break;

    case 12: // Modbus baud (1200..115200) + parity (0 none, 1 odd, 2 even)
      var bd = d.baud >>> 0;
      bytes = [(bd>>8)&0xFF, bd&0xFF, d.parity & 0xFF];
      break;

    default:
      return { bytes: [], fPort: fport, errors: ["unknown fPort " + fport] };
  }
  return { bytes: bytes, fPort: fport };
}

// ===================================================================
// DOWNLINK DECODER — lets the LNS show queued downlinks back as JSON
// ===================================================================
function decodeDownlink(input) {
  var b = input.bytes, p = input.fPort, o = {};
  switch (p) {
    case 16: o.interval = ((b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3]) >>> 0; break;
    case 17: o.adr = b[0]; break;
    case 18: o.msgtype = b[0]; break;
    case 19: o.adr=b[0]; o.sf=b[1]; o.msgtype=b[2]; break;
    case 20:
      o.trig=b[0]; o.param=b[1];
      o.min=((b[2]<<8)|b[3])/100; o.max=((b[4]<<8)|b[5])/100;
      o.checktime=(b[6]<<8)|b[7]; o.enable=b[8];
      break;
    case 21:
      o.param=b[0]; o.count=b[1]; o.enable=b[2];
      if (b.length >= 5) o.interval=(b[3]<<8)|b[4];
      break;
    case 10:
      o.Field=b[0]; o.slaveId=b[1]; o.functionCode=b[2]; o.Enable=b[3];
      o.dataType=b[4]; o.numberOfParameters=b[5];
      o.Registeraddress=(b[6]<<8)|b[7];
      break;
    case 15: o.index = b[0]; break;
    case 13:
      o.slaveId=b[0]; o.functionCode=b[1]; o.dataType=b[2];
      o.numberOfParameters=b[3]; o.Registeraddress=(b[4]<<8)|b[5];
      break;
    case 9:
    case 8:
      o.slaveId=b[0]; o.numberofreg=b[1]; o.address=(b[2]<<8)|b[3];
      o.value = (b.length >= 8)
        ? ((b[4]<<24)|(b[5]<<16)|(b[6]<<8)|b[7])
        : (((b[4]<<8)|b[5]) << 16 >> 16);
      break;
    case 12: o.baud=(b[0]<<8)|b[1]; o.parity=b[2]; break;
  }
  return { data: o };
}
