import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SerialPortDeviceImpl } from '../../src/SerialPortDeviceDetector/SerialPortDeviceImpl';
import { SerialPortInfo } from '../../src/hal/SerialPortHal';

// 身份退化链与 Unknown 兜底契约（doc/Test/开发测试体系规划.md §6.3）：
// serial（非空非全 0）→ vid+pid+locationId（三者齐备）→ path；
// 信息字段缺失经 l10n 返回「Unknown」空标记。运行期 'vscode' 由模块桩提供。
const makeInfo = (overrides: Partial<SerialPortInfo> = {}): SerialPortInfo => ({
  path: 'COM3',
  vendorId: '2341',
  productId: '0043',
  manufacturer: 'Arduino',
  serialNumber: 'SERIAL_123',
  locationId: '1.2',
  ...overrides,
});

describe('SerialPortDeviceImpl 身份退化链', () => {
  it('#1 prefers a valid serial number over vid/pid/locationId', () => {
    const device = new SerialPortDeviceImpl(makeInfo());
    assert.equal(device.identity, 'serial:SERIAL_123');
  });

  it('#2 falls back to vid-pid-loc when the serial is all zeros', () => {
    const device = new SerialPortDeviceImpl(makeInfo({ serialNumber: '0000' }));
    assert.equal(device.identity, 'vid-pid-loc:2341-0043-1.2');
  });

  it('#3 falls back to vid-pid-loc when the serial is missing or empty', () => {
    const without = new SerialPortDeviceImpl(makeInfo({ serialNumber: undefined }));
    assert.equal(without.identity, 'vid-pid-loc:2341-0043-1.2');
    const empty = new SerialPortDeviceImpl(makeInfo({ serialNumber: '' }));
    assert.equal(empty.identity, 'vid-pid-loc:2341-0043-1.2');
  });

  it('#4 falls back to the path when nothing else is available', () => {
    const device = new SerialPortDeviceImpl({
      path: 'COM3',
      vendorId: undefined,
      productId: undefined,
      serialNumber: undefined,
      locationId: undefined,
      manufacturer: undefined,
    });
    assert.equal(device.identity, 'path:COM3');
  });

  it('#5 requires all three second-level fields before using vid-pid-loc', () => {
    // 第二级缺一（此处缺 locationId）即落到第三级 path 兜底。
    const device = new SerialPortDeviceImpl({
      path: 'COM7',
      vendorId: '2341',
      productId: '0043',
      serialNumber: undefined,
      locationId: undefined,
      manufacturer: undefined,
    });
    assert.equal(device.identity, 'path:COM7');
  });
});

describe('SerialPortDeviceImpl 字段与状态', () => {
  it('#6 reports Unknown for every missing info field', () => {
    const device = new SerialPortDeviceImpl({
      path: 'COM3',
      vendorId: undefined,
      productId: undefined,
      manufacturer: undefined,
      serialNumber: undefined,
      locationId: undefined,
    });
    assert.equal(device.vendorId, 'Unknown');
    assert.equal(device.productId, 'Unknown');
    assert.equal(device.manufacturer, 'Unknown');
    assert.equal(device.serialNumber, 'Unknown');
    assert.equal(device.locationId, 'Unknown');
  });

  it('#7 returns raw values for present info fields', () => {
    const device = new SerialPortDeviceImpl(makeInfo());
    assert.equal(device.path, 'COM3');
    assert.equal(device.vendorId, '2341');
    assert.equal(device.productId, '0043');
    assert.equal(device.manufacturer, 'Arduino');
    assert.equal(device.serialNumber, 'SERIAL_123');
    assert.equal(device.locationId, '1.2');
  });

  it('#8 starts disconnected and accepts status writes', () => {
    const device = new SerialPortDeviceImpl(makeInfo());
    assert.equal(device.status, 'disconnected');
    device.setStatus('connecting');
    assert.equal(device.status, 'connecting');
    device.setStatus('connected');
    assert.equal(device.status, 'connected');
  });
});
