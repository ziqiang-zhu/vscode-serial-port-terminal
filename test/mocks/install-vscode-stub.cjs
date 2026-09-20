'use strict';

// 测试专用模块桩：经 `node --require ./test/mocks/install-vscode-stub.cjs` 预加载，
// 劫持 Module._load 把 'vscode' 重定向到最小测试替身（见 doc/Test/开发测试体系规划.md §5.2）。
// 仅实现 P0 单元测试所需成员；业务源码零改动。

const { EventEmitter: NodeEventEmitter } = require('node:events');
const Module = require('node:module');

class Disposable {
  constructor(callback) {
    this._callback = callback;
  }
  dispose() {
    if (typeof this._callback === 'function') {
      this._callback();
    }
  }
}

class EventEmitter {
  constructor() {
    this._emitter = new NodeEventEmitter();
  }
  // vscode.Event<T>：订阅返回 Disposable。
  get event() {
    return (listener) => {
      const wrapped = (data) => listener(data);
      this._emitter.on('event', wrapped);
      return new Disposable(() => this._emitter.off('event', wrapped));
    };
  }
  fire(data) {
    this._emitter.emit('event', data);
  }
  dispose() {
    this._emitter.removeAllListeners();
  }
}

const l10n = {
  // 仅实现 P0 用到的 {n} 占位符替换。
  t(message, ...args) {
    return String(message).replace(/\{(\d+)\}/g, (raw, index) => {
      const value = args[Number(index)];
      return value === undefined ? raw : String(value);
    });
  },
};

const workspace = {
  _configuration: new Map(),
  getConfiguration() {
    return {
      get(key, defaultValue) {
        return workspace._configuration.has(key) ? workspace._configuration.get(key) : defaultValue;
      },
    };
  },
};

const vscodeStub = {
  Disposable,
  EventEmitter,
  l10n,
  workspace,
  // 测试专用钩子（非 vscode API）：注入 workspace 配置值，undefined 表示清除。
  __setConfiguration(key, value) {
    if (value === undefined) {
      workspace._configuration.delete(key);
    } else {
      workspace._configuration.set(key, value);
    }
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
